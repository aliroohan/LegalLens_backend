import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

const router = Router();

router.use(requireAuth);

router.get('/notifications', NotificationController.listUserNotifications);
router.patch('/notifications/:notificationId/read', NotificationController.markAsRead);
router.post('/notifications/read-all', NotificationController.markAllAsRead);

export default router;
