import type { FileProcessingStatus } from '../config/constants.ts';

export type FileCategory = 'image' | 'document' | 'video' | 'audio';

export interface IFileRecord {
  fileId: string;
  caseId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileCategory: FileCategory;
  sizeBytes: number;
  uploaderId: string;
  orgId?: string;
  sha256Hash: string;
  storagePath: string;
  workingCopyPath: string;
  processingStatus: FileProcessingStatus;
  isDeleted: boolean;
  uploadedAt: Date;
  deletedAt?: Date;
}

export interface UploadedFileResponse {
  fileId: string;
  caseId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileCategory: FileCategory;
  sizeBytes: number;
  sha256Hash: string;
  processingStatus: FileProcessingStatus;
  uploadedAt: Date;
}
