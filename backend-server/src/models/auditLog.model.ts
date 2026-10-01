import mongoose, { Schema, type Document } from 'mongoose';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES, type AuditAction, type AuditTargetType } from '../config/constants.ts';

export interface IAuditLogDocument extends Document {
  logId: string;
  userId: string;
  userEmail?: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  caseId?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  ipAddress?: string;
}

const AuditLogSchema = new Schema<IAuditLogDocument>(
  {
    logId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userEmail: { type: String },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    targetType: { type: String, enum: AUDIT_TARGET_TYPES, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    caseId: { type: String, index: true },
    details: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
    ipAddress: { type: String }
  },
  {
    timestamps: false
  }
);

// Immutable index query optimization
AuditLogSchema.index({ caseId: 1, timestamp: -1 });

export const AuditLogModel = mongoose.model<IAuditLogDocument>('AuditLog', AuditLogSchema);
