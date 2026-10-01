import mongoose, { Schema, type Document } from 'mongoose';

export interface IReportDocument extends Document {
  reportId: string;
  caseId: string;
  generatedBy: string;
  title: string;
  summary: Record<string, unknown>;
  reportPath?: string;
  createdAt: Date;
}

const ReportSchema = new Schema<IReportDocument>(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    caseId: { type: String, required: true, index: true },
    generatedBy: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: Schema.Types.Mixed, default: {} },
    reportPath: { type: String }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

ReportSchema.index({ caseId: 1, createdAt: -1 });

export const ReportModel = mongoose.model<IReportDocument>('Report', ReportSchema);
