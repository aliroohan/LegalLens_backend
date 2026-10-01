import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model.ts';
import { ENV } from '../config/env.ts';
import type { RegisterInput, LoginInput } from '../validators/auth.validator.ts';
import type { LoginResponse, UserResponse } from '../types/auth.types.ts';
import { AuditService } from './audit.service.ts';

export class AuthService {
  /**
   * Register a new user
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

    const user = await UserModel.create({
      userId,
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      role: input.role || 'lawyer',
      firmId: input.firmId || 'firm_default'
    });

    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      firmId: user.firmId,
      createdAt: user.createdAt
    };
  }

  /**
   * Login user and issue 7-day JWT token (FR-1.1)
   */
  static async login(input: LoginInput, ipAddress?: string): Promise<LoginResponse> {
    const user = await UserModel.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
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

    // Generate JWT token (FR-1.1: 7-day validity)
    const token = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        firmId: user.firmId
      },
      ENV.JWT_SECRET,
      { expiresIn: '7d' }
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
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        firmId: user.firmId,
        createdAt: user.createdAt
      },
      token
    };
  }

  /**
   * Get user profile by ID
   */
  static async getProfile(userId: string): Promise<UserResponse | null> {
    const user = await UserModel.findOne({ userId });
    if (!user) return null;
    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      firmId: user.firmId,
      createdAt: user.createdAt
    };
  }
}
