import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel, type IUserDocument } from '../models/user.model.ts';
import { TokenBlacklistModel } from '../models/tokenBlacklist.model.ts';
import { ENV } from '../config/env.ts';
import {
  USER_ROLES,
  BAR_ID_STATUS,
  DEFAULT_INDEPENDENT_STORAGE_BYTES,
  DEFAULT_INDEPENDENT_MONTHLY_FORENSIC_LIMIT,
  type UserRole,
  type BarIdStatus
} from '../config/constants.ts';
import type {
  RegisterInput,
  RegisterIndependentInput,
  LoginInput,
  ResetPasswordInput
} from '../validators/auth.validator.ts';
import type { LoginResponse, UserResponse, AuthUserPayload } from '../types/auth.types.ts';
import { AuditService } from './audit.service.ts';
import { logger } from '../utils/logger.ts';

export class AuthService {
  /**
   * Helper to format user response
   */
  static formatUserResponse(user: IUserDocument): UserResponse {
    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      firmId: user.firmId || user.orgId,
      isIndependent: user.isIndependent || false,
      barId: user.barId,
      barIdStatus: user.barIdStatus,
      allocatedStorageBytes: user.allocatedStorageBytes,
      usedStorageBytes: user.usedStorageBytes,
      monthlyForensicLimit: user.monthlyForensicLimit,
      currentMonthForensicRuns: user.currentMonthForensicRuns,
      isActive: user.isActive,
      createdAt: user.createdAt
    };
  }

  /**
   * Register an independent lawyer without belonging to an organization (FR-1.4, FR-1.5)
   */
  static async registerIndependent(input: RegisterIndependentInput): Promise<UserResponse> {
    const existing = await UserModel.findOne({ email: input.email.toLowerCase() });
    if (existing) {
      const error = new Error('A user with this email address already exists.');
      (error as any).code = 'EMAIL_ALREADY_EXISTS';
      (error as any).status = 409;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);
    const userId = crypto.randomUUID();

    const user = await UserModel.create({
      userId,
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name.trim(),
      role: USER_ROLES.LAWYER,
      isIndependent: true,
      barId: input.barId.trim(),
      barIdStatus: BAR_ID_STATUS.PENDING, // Account pending Bar ID confirmation (FR-1.5)
      allocatedStorageBytes: DEFAULT_INDEPENDENT_STORAGE_BYTES,
      usedStorageBytes: 0,
      monthlyForensicLimit: DEFAULT_INDEPENDENT_MONTHLY_FORENSIC_LIMIT,
      currentMonthForensicRuns: 0,
      isActive: true
    });

    // Audit registration
    await AuditService.logAction({
      userId,
      userEmail: user.email,
      action: 'LAWYER_REGISTER',
      targetType: 'USER',
      targetId: userId,
      details: {
        isIndependent: true,
        barId: user.barId,
        barIdStatus: user.barIdStatus
      }
    });

    logger.info(`[AuthService] Independent lawyer registered: ${user.email} (${userId}). Bar ID: ${user.barId}`);
    return this.formatUserResponse(user);
  }

  /**
   * General register (for initial seeds or admins)
   */
  static async register(input: RegisterInput): Promise<UserResponse> {
    const existing = await UserModel.findOne({ email: input.email.toLowerCase() });
    if (existing) {
      const error = new Error('A user with this email already exists.');
      (error as any).code = 'EMAIL_ALREADY_EXISTS';
      (error as any).status = 409;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);
    const userId = crypto.randomUUID();

    const role = (input.role as UserRole) || USER_ROLES.LAWYER;
    const isIndependent = input.isIndependent ?? (!input.orgId && !input.firmId);

    const user = await UserModel.create({
      userId,
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      role,
      orgId: input.orgId || input.firmId,
      firmId: input.firmId || input.orgId,
      isIndependent,
      barId: input.barId,
      barIdStatus: role === USER_ROLES.SUPER_ADMIN ? BAR_ID_STATUS.VERIFIED : BAR_ID_STATUS.PENDING,
      allocatedStorageBytes: isIndependent ? DEFAULT_INDEPENDENT_STORAGE_BYTES : 0,
      usedStorageBytes: 0,
      monthlyForensicLimit: isIndependent ? DEFAULT_INDEPENDENT_MONTHLY_FORENSIC_LIMIT : 0,
      currentMonthForensicRuns: 0,
      isActive: true
    });

    return this.formatUserResponse(user);
  }

  /**
   * Login user and issue 8-hour JWT session token (FR-1.7, NFR Security)
   */
  static async login(input: LoginInput, ipAddress?: string): Promise<LoginResponse> {
    const user = await UserModel.findOne({ email: input.email.toLowerCase(), isActive: true }).select(
      '+passwordHash'
    );
    if (!user) {
      const error = new Error('Invalid email or password.');
      (error as any).code = 'INVALID_CREDENTIALS';
      (error as any).status = 401;
      throw error;
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      const error = new Error('Invalid email or password.');
      (error as any).code = 'INVALID_CREDENTIALS';
      (error as any).status = 401;
      throw error;
    }

    // Update last activity date (FR-1.7 inactivity check)
    user.lastActivityAt = new Date();
    await user.save();

    // Generate JWT token (8 hours of validity as per FR-1.7)
    const token = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        firmId: user.firmId || user.orgId,
        isIndependent: user.isIndependent,
        barId: user.barId,
        barIdStatus: user.barIdStatus
      } as AuthUserPayload,
      ENV.JWT_SECRET,
      { expiresIn: ENV.JWT_EXPIRES_IN as any }
    );

    // Audit login action (FR-7.1)
    await AuditService.logAction({
      userId: user.userId,
      userEmail: user.email,
      action: 'AUTH_LOGIN',
      targetType: 'USER',
      targetId: user.userId,
      ipAddress
    });

    return {
      user: this.formatUserResponse(user),
      token
    };
  }

  /**
   * Logout user and invalidate the current session token (FR-1.8)
   */
  static async logout(token: string, userId: string, userEmail?: string, ipAddress?: string): Promise<void> {
    try {
      // Decode token to get expiry
      const decoded = jwt.decode(token) as { exp?: number };
      const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 8 * 60 * 60 * 1000);

      // Store in blacklist
      await TokenBlacklistModel.create({
        token,
        userId,
        expiresAt
      });

      // Audit logout
      await AuditService.logAction({
        userId,
        userEmail,
        action: 'AUTH_LOGOUT',
        targetType: 'USER',
        targetId: userId,
        ipAddress
      });

      logger.info(`[AuthService] Session token invalidated for user: ${userId}`);
    } catch (error) {
      logger.error('[AuthService] Logout failed:', error);
      throw error;
    }
  }

  /**
   * Verify/activate lawyer's Bar ID (FR-1.5)
   */
  static async verifyBarId(
    targetUserId: string,
    status: BarIdStatus,
    verifierUserId: string,
    verifierEmail?: string,
    notes?: string
  ): Promise<UserResponse> {
    const user = await UserModel.findOne({ userId: targetUserId, isActive: true });
    if (!user) {
      const err = new Error('Lawyer account not found.');
      (err as any).code = 'USER_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    user.barIdStatus = status;
    await user.save();

    await AuditService.logAction({
      userId: verifierUserId,
      userEmail: verifierEmail,
      action: 'BAR_ID_VERIFY',
      targetType: 'USER',
      targetId: targetUserId,
      details: {
        newStatus: status,
        barId: user.barId,
        notes
      }
    });

    return this.formatUserResponse(user);
  }

  /**
   * Forgot password: generate reset token (FR-1.11)
   */
  static async forgotPassword(email: string): Promise<{ message: string; resetToken?: string }> {
    const user = await UserModel.findOne({ email: email.toLowerCase(), isActive: true });
    if (!user) {
      // Return safe message without leaking user existence (FR-1.10)
      return { message: 'If an account exists with that email, a password reset link has been dispatched.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour validity
    await user.save();

    await AuditService.logAction({
      userId: user.userId,
      userEmail: user.email,
      action: 'PASSWORD_RESET_REQUEST',
      targetType: 'USER',
      targetId: user.userId
    });

    logger.info(`[AuthService] Password reset token generated for ${user.email}: ${resetToken}`);
    return {
      message: 'If an account exists with that email, a password reset link has been dispatched.',
      resetToken // In development returned for easy testing; in production dispatched via email
    };
  }

  /**
   * Reset password using reset token (FR-1.11)
   */
  static async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const hashedToken = crypto.createHash('sha256').update(input.token).digest('hex');

    const user = await UserModel.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
      isActive: true
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      const err = new Error('Password reset token is invalid or has expired.');
      (err as any).code = 'INVALID_RESET_TOKEN';
      (err as any).status = 400;
      throw err;
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(input.newPassword, salt);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    await AuditService.logAction({
      userId: user.userId,
      userEmail: user.email,
      action: 'PASSWORD_RESET_COMPLETE',
      targetType: 'USER',
      targetId: user.userId
    });

    return { message: 'Password has been successfully reset. You can now log in with your new credentials.' };
  }

  /**
   * Org Admin resets lawyer password (FR-1.12)
   */
  static async adminResetUserPassword(
    orgId: string,
    targetUserId: string,
    adminUserId: string,
    adminEmail?: string,
    explicitNewPassword?: string
  ): Promise<{ message: string; tempPassword?: string }> {
    const user = await UserModel.findOne({ userId: targetUserId, orgId, isActive: true });
    if (!user) {
      const err = new Error('User not found in your organization.');
      (err as any).code = 'USER_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    const tempPassword = explicitNewPassword || crypto.randomBytes(6).toString('hex') + 'A1!';
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(tempPassword, salt);
    await user.save();

    await AuditService.logAction({
      userId: adminUserId,
      userEmail: adminEmail,
      action: 'ORG_ADMIN_PASSWORD_RESET',
      targetType: 'USER',
      targetId: targetUserId,
      details: {
        orgId,
        userEmail: user.email
      }
    });

    logger.info(`[AuthService] Org admin ${adminUserId} reset password for user ${user.email}.`);
    return {
      message: `Password reset successfully for '${user.email}'. Credentials sent via email.`,
      tempPassword
    };
  }

  /**
   * Get user profile by userId
   */
  static async getProfile(userId: string): Promise<UserResponse> {
    const user = await UserModel.findOne({ userId, isActive: true });
    if (!user) {
      const error = new Error('User not found.');
      (error as any).code = 'USER_NOT_FOUND';
      (error as any).status = 404;
      throw error;
    }

    return this.formatUserResponse(user);
  }
}
