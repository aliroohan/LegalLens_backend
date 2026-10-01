export type FileCategory = 'image' | 'document';

export interface IFileRecord {
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
  uploadedAt: Date;
}
