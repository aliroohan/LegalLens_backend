import mongoose, { Schema, type Document } from 'mongoose';
import type { FileCategory } from '../types/file.types.ts';

export interface IFileDocument extends Document {
  fileId: string;
  caseId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileCategory: FileCategory;
  sizeBytes: number;
  uploaderId: string;
  sha256Hash: string;
  storagePath: string;
  workingCopyPath: string;
  isDeleted: boolean;
  uploadedAt: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FileSchema = new Schema<IFileDocument>(
  {
    fileId: { type: String, required: true, unique: true, index: true },
    caseId: { type: String, required: true, index: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileCategory: { type: String, enum: ['image', 'document'], required: true, index: true },
    sizeBytes: { type: Number, required: true },
    uploaderId: { type: String, required: true, index: true },
    sha256Hash: { type: String, required: true, index: true },
    storagePath: { type: String, required: true },
    workingCopyPath: { type: String, required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    uploadedAt: { type: Date, default: Date.now },
    deletedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

FileSchema.index({ caseId: 1, isDeleted: 1, uploadedAt: -1 });

export const FileModel = mongoose.model<IFileDocument>('File', FileSchema);
