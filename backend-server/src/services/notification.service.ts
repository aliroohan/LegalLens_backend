import crypto from 'node:crypto';
import {
  NotificationModel,
  type INotificationDocument,
  type NotificationType
} from '../models/notification.model.ts';
import { logger } from '../utils/logger.ts';

export class NotificationService {
  /**
   * Create and persist a new notification (FR-5.1 - FR-5.5)
   */
  static async sendNotification(params: {
    userId: string;
    orgId?: string;
    caseId?: string;
    fileId?: string;
    type: NotificationType;
    title: string;
    message: string;
  }): Promise<INotificationDocument> {
    try {
      const notificationId = crypto.randomUUID();
      const notification = await NotificationModel.create({
        notificationId,
        userId: params.userId,
        orgId: params.orgId,
        caseId: params.caseId,
        fileId: params.fileId,
        type: params.type,
        title: params.title,
        message: params.message,
        read: false
      });
      return notification;
    } catch (error) {
      logger.error('[NotificationService] Failed to create notification:', error);
      throw error;
    }
  }

  /**
   * Get notifications for a user
   */
  static async getUserNotifications(userId: string, unreadOnly = false) {
    const filter: Record<string, unknown> = { userId };
    if (unreadOnly) {
      filter.read = false;
    }
    return NotificationModel.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  }

  /**
   * Mark a notification as read
   */
  static async markAsRead(notificationId: string, userId: string) {
    return NotificationModel.findOneAndUpdate(
      { notificationId, userId },
      { read: true },
      { new: true }
    );
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId: string) {
    return NotificationModel.updateMany({ userId, read: false }, { read: true });
  }
}
