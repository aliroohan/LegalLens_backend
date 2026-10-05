import mongoose, { Schema, type Document } from 'mongoose';
import {
  USER_ROLES,
  BAR_ID_STATUS,
  DEFAULT_INDEPENDENT_STORAGE_BYTES,
  DEFAULT_INDEPENDENT_MONTHLY_FORENSIC_LIMIT,
  type UserRole,
  type BarIdStatus
} from '../config/constants.ts';

export interface IUserDocument extends Document {
  userId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  orgId?: string;
  firmId?: string; // alias for backwards compatibility
  isIndependent: boolean;
  barId?: string;
  barIdStatus: BarIdStatus;
  allocatedStorageBytes: number;
  usedStorageBytes: number;
  monthlyForensicLimit: number;
  currentMonthForensicRuns: number;
  usageMonth: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  lastActivityAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.LAWYER,
      index: true
    },
    orgId: { type: String, index: true },
    firmId: { type: String, index: true },
    isIndependent: { type: Boolean, default: false, index: true },
    barId: { type: String, index: true, trim: true },
    barIdStatus: {
      type: String,
      enum: Object.values(BAR_ID_STATUS),
      default: BAR_ID_STATUS.PENDING,
      index: true
    },
    allocatedStorageBytes: {
      type: Number,
      default: DEFAULT_INDEPENDENT_STORAGE_BYTES
    },
    usedStorageBytes: { type: Number, default: 0, min: 0 },
    monthlyForensicLimit: {
      type: Number,
      default: DEFAULT_INDEPENDENT_MONTHLY_FORENSIC_LIMIT
    },
    currentMonthForensicRuns: { type: Number, default: 0, min: 0 },
    usageMonth: {
      type: String,
      default: () => new Date().toISOString().slice(0, 7)
    },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    lastActivityAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true, index: true }
  },
  {
    timestamps: true
  }
);

UserSchema.index({ orgId: 1, role: 1, isActive: 1 });

export const UserModel = mongoose.model<IUserDocument>('User', UserSchema);
