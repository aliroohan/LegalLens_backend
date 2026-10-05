import mongoose, { Schema, type Document } from 'mongoose';
import {
  ORG_STATUS,
  type OrgStatus,
  DEFAULT_ORG_MAX_USERS,
  DEFAULT_ORG_STORAGE_BYTES,
  DEFAULT_ORG_MONTHLY_FORENSIC_LIMIT
} from '../config/constants.ts';

export interface IOrganizationDocument extends Document {
  orgId: string;
  name: string;
  adminEmail: string;
  adminUserId?: string;
  status: OrgStatus;
  maxUsers: number;
  allocatedStorageBytes: number;
  usedStorageBytes: number;
  monthlyForensicLimit: number;
  currentMonthForensicRuns: number;
  usageMonth: string; // e.g., '2026-10' for monthly auto-reset
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganizationDocument>(
  {
    orgId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    adminEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    adminUserId: { type: String, index: true },
    status: {
      type: String,
      enum: Object.values(ORG_STATUS),
      default: ORG_STATUS.ACTIVE,
      index: true
    },
    maxUsers: { type: Number, default: DEFAULT_ORG_MAX_USERS, min: 1 },
    allocatedStorageBytes: {
      type: Number,
      default: DEFAULT_ORG_STORAGE_BYTES,
      min: 0
    },
    usedStorageBytes: { type: Number, default: 0, min: 0 },
    monthlyForensicLimit: {
      type: Number,
      default: DEFAULT_ORG_MONTHLY_FORENSIC_LIMIT,
      min: 0
    },
    currentMonthForensicRuns: { type: Number, default: 0, min: 0 },
    usageMonth: {
      type: String,
      default: () => new Date().toISOString().slice(0, 7) // 'YYYY-MM'
    }
  },
  {
    timestamps: true
  }
);

OrganizationSchema.index({ status: 1, createdAt: -1 });

export const OrganizationModel = mongoose.model<IOrganizationDocument>(
  'Organization',
  OrganizationSchema
);
