import mongoose, { Schema, type Document } from 'mongoose';
import { AUTHENTICITY_LABELS, type AuthenticityLabel } from '../config/constants.ts';
import type { ModuleResult } from '../types/forensic.types.ts';

export interface IForensicResultDocument extends Document {
  resultId: string;
  fileId: string;
  caseId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  fusionScore: number | null;
  authenticityLabel: AuthenticityLabel | null;
  modules: {
    exif: ModuleResult;
    ela: ModuleResult;
    copyMove: ModuleResult;
    noise: ModuleResult;
    lighting: ModuleResult;
    deepfake: ModuleResult;
  };
  weightsApplied: Record<string, number>;
  errorMessage?: string;
  durationMs?: number;
  analyzedAt: Date;
  retriggeredCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ModuleResultSchema = new Schema<ModuleResult>(
  {
    status: { type: String, enum: ['success', 'not_applicable', 'failed'], default: 'success' },
    subScore: { type: Number, default: null },
    explanation: { type: String, default: '' },
    heatmapUrl: { type: String, default: null },
    heatmapBase64: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const ForensicResultSchema = new Schema<IForensicResultDocument>(
  {
    resultId: { type: String, required: true, unique: true, index: true },
    fileId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    fusionScore: { type: Number, default: null },
    authenticityLabel: {
      type: String,
      enum: Object.values(AUTHENTICITY_LABELS),
      default: null
    },
    modules: {
      exif: { type: ModuleResultSchema, required: true },
      ela: { type: ModuleResultSchema, required: true },
      copyMove: { type: ModuleResultSchema, required: true },
      noise: { type: ModuleResultSchema, required: true },
      lighting: { type: ModuleResultSchema, required: true },
      deepfake: { type: ModuleResultSchema, required: true }
    },
    weightsApplied: { type: Schema.Types.Mixed, default: {} },
    errorMessage: { type: String },
    durationMs: { type: Number },
    analyzedAt: { type: Date, default: Date.now },
    retriggeredCount: { type: Number, default: 0 }
  },
  {
    timestamps: true
  }
);

ForensicResultSchema.index({ fileId: 1, createdAt: -1 });

export const ForensicResultModel = mongoose.model<IForensicResultDocument>(
  'ForensicResult',
  ForensicResultSchema
);
