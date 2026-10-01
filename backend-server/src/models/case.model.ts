import mongoose, { Schema, type Document } from 'mongoose';
import { MATTER_TYPES, CASE_STATUS, type MatterType, type CaseStatus } from '../config/constants.ts';

export interface ICaseDocument extends Document {
  caseId: string;
  caseName: string;
  clientName: string;
  matterType: MatterType;
  description?: string;
  status: CaseStatus;
  fileCount: number;
  lastActivityAt: Date;
  createdBy: string;
  firmId?: string;
  isDeleted: boolean;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CaseSchema = new Schema<ICaseDocument>(
  {
    caseId: { type: String, required: true, unique: true, index: true },
    caseName: { type: String, required: true, maxlength: 120, trim: true },
    clientName: { type: String, required: true, trim: true, index: true },
    matterType: { type: String, enum: MATTER_TYPES, required: true, index: true },
    description: { type: String, maxlength: 1000, default: '' },
    status: { type: String, enum: CASE_STATUS, default: 'Open', index: true },
    fileCount: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: String, required: true, index: true },
    firmId: { type: String, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    closedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

// Compound indexes for performant search & dashboard sorting
CaseSchema.index({ firmId: 1, isDeleted: 1, lastActivityAt: -1 });
CaseSchema.index({ clientName: 'text', caseName: 'text' });

export const CaseModel = mongoose.model<ICaseDocument>('Case', CaseSchema);
