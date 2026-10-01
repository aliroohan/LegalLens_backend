import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.ts';
import { sendSuccess } from '../utils/apiResponse.ts';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AuthService.register(req.body);
      sendSuccess(res, user, 201);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ipAddress = req.ip || req.socket.remoteAddress;
      const result = await AuthService.login(req.body, ipAddress);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
        return;
      }
      const profile = await AuthService.getProfile(req.user.userId);
      sendSuccess(res, profile, 200);
    } catch (error) {
      next(error);
    }
  }
}
