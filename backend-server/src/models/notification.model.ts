import mongoose, { Schema, type Document } from 'mongoose';

export type NotificationType =
  | 'FORENSIC_COMPLETED'
  | 'FORENSIC_FAILED'
  | 'REPORT_READY'
  | 'LIMIT_REACHED'
  | 'BAR_ID_VERIFIED'
  | 'BAR_ID_REJECTED';

export interface INotificationDocument extends Document {
  notificationId: string;
  userId: string;
  orgId?: string;
  caseId?: string;
  fileId?: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotificationDocument>(
  {
    notificationId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    orgId: { type: String, index: true },
    caseId: { type: String, index: true },
    fileId: { type: String, index: true },
    type: {
      type: String,
      enum: [
        'FORENSIC_COMPLETED',
        'FORENSIC_FAILED',
        'REPORT_READY',
        'LIMIT_REACHED',
        'BAR_ID_VERIFIED',
        'BAR_ID_REJECTED'
      ],
      required: true,
      index: true
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false, index: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export const NotificationModel = mongoose.model<INotificationDocument>(
  'Notification',
  NotificationSchema
);
