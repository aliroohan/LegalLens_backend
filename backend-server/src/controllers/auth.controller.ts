import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.ts';
import { sendSuccess, sendError } from '../utils/apiResponse.ts';

export class AuthController {
  /**
   * General register (initial seeds or admins)
   */
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AuthService.register(req.body);
      sendSuccess(res, user, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Register independent lawyer (FR-1.4, FR-1.5)
   */
  static async registerIndependent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AuthService.registerIndependent(req.body);
      sendSuccess(
        res,
        user,
        201,
        {
          notice: 'Account created. Bar ID is pending verification. Case management will be enabled once verified.'
        }
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login user and issue 8-hour JWT session token (FR-1.7)
   */
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ipAddress = req.ip || req.socket.remoteAddress;
      const result = await AuthService.login(req.body, ipAddress);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout user and invalidate session token (FR-1.8)
   */
  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
      if (!token) {
        sendError(res, 400, 'TOKEN_MISSING', 'Bearer token is required for logout.');
        return;
      }
      const userId = req.user!.userId;
      const userEmail = req.user?.email;
      const ipAddress = req.ip || req.socket.remoteAddress;

      await AuthService.logout(token, userId, userEmail, ipAddress);
      sendSuccess(res, { message: 'Successfully logged out. Session invalidated.' }, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify lawyer Bar ID (FR-1.5)
   */
  static async verifyBarId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const targetUserId = req.params.userId as string;
      const { status, notes } = req.body;
      const verifierUserId = req.user!.userId;
      const verifierEmail = req.user?.email;

      const updated = await AuthService.verifyBarId(
        targetUserId,
        status,
        verifierUserId,
        verifierEmail,
        notes
      );
      sendSuccess(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Self-service forgot password (FR-1.11)
   */
  static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.forgotPassword(req.body.email);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Self-service reset password (FR-1.11)
   */
  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.resetPassword(req.body);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Org admin resets lawyer password (FR-1.12)
   */
  static async adminResetUserPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.user?.orgId || req.user?.firmId;
      const targetUserId = req.params.userId as string;
      const adminUserId = req.user!.userId;
      const adminEmail = req.user?.email;

      if (!orgId) {
        sendError(res, 400, 'NO_ORG_ASSOCIATION', 'User is not associated with an organization.');
        return;
      }

      const result = await AuthService.adminResetUserPassword(
        orgId,
        targetUserId,
        adminUserId,
        adminEmail,
        req.body.newPassword
      );
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetch current authenticated user profile
   */
  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 401, 'UNAUTHORIZED', 'Not authenticated');
        return;
      }
      const profile = await AuthService.getProfile(req.user.userId);
      sendSuccess(res, profile, 200);
    } catch (error) {
      next(error);
    }
  }
}
