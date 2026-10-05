import type { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service.ts';
import { sendSuccess } from '../utils/apiResponse.ts';

export class NotificationController {
  static async listUserNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const unreadOnly = req.query.unreadOnly === 'true';

      const notifications = await NotificationService.getUserNotifications(userId, unreadOnly);
      sendSuccess(res, notifications, 200);
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const notificationId = req.params.notificationId as string;

      const updated = await NotificationService.markAsRead(notificationId, userId);
      sendSuccess(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }

  static async markAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      await NotificationService.markAllAsRead(userId);
      sendSuccess(res, { message: 'All notifications marked as read.' }, 200);
    } catch (error) {
      next(error);
    }
  }
}
