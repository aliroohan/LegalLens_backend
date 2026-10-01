import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileModel, type IFileDocument } from '../models/file.model.ts';
import { CaseModel } from '../models/case.model.ts';
import { ENV } from '../config/env.ts';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_DOCUMENT_SIZE_BYTES
} from '../config/constants.ts';
import { computeSha256 } from '../utils/hash.ts';
import type { UploadedFileResponse, FileCategory } from '../types/file.types.ts';
import { AuditService } from './audit.service.ts';
import { CaseService } from './case.service.ts';

export class FileService {
  /**
   * Ensure upload directories exist
   */
  private static async ensureDirectories(caseId: string): Promise<{ originalsDir: string; workingDir: string }> {
    const originalsDir = path.join(ENV.UPLOAD_DIR, caseId, 'originals');
    const workingDir = path.join(ENV.UPLOAD_DIR, caseId, 'working_copies');

    await fs.mkdir(originalsDir, { recursive: true });
    await fs.mkdir(workingDir, { recursive: true });

    return { originalsDir, workingDir };
  }

  /**
   * Process and save a batch of uploaded files (FR-3.1 - FR-3.6)
   */
  static async uploadFiles(
    caseId: string,
    files: Express.Multer.File[],
    userId: string,
    userEmail?: string
  ): Promise<UploadedFileResponse[]> {
    // Verify case exists and is not closed (FR-2.5)
    const targetCase = await CaseModel.findOne({ caseId, isDeleted: false });
    if (!targetCase) {
      const err = new Error('Case not found.');
      (err as any).status = 404;
      (err as any).code = 'CASE_NOT_FOUND';
      throw err;
    }

    if (targetCase.status === 'Closed') {
      const err = new Error('Cannot upload files to a closed case.');
      (err as any).status = 403;
      (err as any).code = 'CASE_CLOSED';
      throw err;
    }

    if (!files || files.length === 0) {
      const err = new Error('No files provided for upload.');
      (err as any).status = 400;
      (err as any).code = 'NO_FILES_PROVIDED';
      throw err;
    }

    const { originalsDir, workingDir } = await this.ensureDirectories(caseId);
    const uploadedResults: UploadedFileResponse[] = [];

    for (const file of files) {
      const mime = file.mimetype.toLowerCase();
      const isImage = (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
      const fileCategory: FileCategory = isImage ? 'image' : 'document';
      const maxAllowedSize = isImage ? MAX_IMAGE_SIZE_BYTES : MAX_DOCUMENT_SIZE_BYTES;

      // Validate size per category (FR-3.3)
      if (file.size > maxAllowedSize) {
        const err = new Error(
          `File '${file.originalname}' exceeds the limit of ${
            isImage ? '10MB' : '25MB'
          } for ${fileCategory}s.`
        );
        (err as any).status = 400;
        (err as any).code = 'FILE_SIZE_LIMIT_EXCEEDED';
        throw err;
      }

      // Compute SHA-256 hash at ingestion time (FR-3.5)
      const sha256Hash = computeSha256(file.buffer);
      const fileId = crypto.randomUUID();
      const ext = path.extname(file.originalname);
      const safeFilename = `${fileId}${ext}`;

      const originalStoragePath = path.join(originalsDir, safeFilename);
      const workingStoragePath = path.join(workingDir, safeFilename);

      // Store unmodified original file (FR-3.4)
      await fs.writeFile(originalStoragePath, file.buffer);

      // Create working copy for any forensics/processing (FR-3.4)
      await fs.writeFile(workingStoragePath, file.buffer);

      // Persist file record (FR-3.6)
      const fileDoc = await FileModel.create({
        fileId,
        caseId,
        filename: safeFilename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileCategory,
        sizeBytes: file.size,
        uploaderId: userId,
        sha256Hash,
        storagePath: originalStoragePath,
        workingCopyPath: workingStoragePath,
        isDeleted: false,
        uploadedAt: new Date()
      });

      // Audit file upload (FR-7.1)
      await AuditService.logAction({
        userId,
        userEmail,
        action: 'FILE_UPLOAD',
        targetType: 'FILE',
        targetId: fileId,
        caseId,
        details: {
          filename: file.originalname,
          sizeBytes: file.size,
          mimeType: file.mimetype,
          sha256Hash
        }
      });

      uploadedResults.push({
        fileId: fileDoc.fileId,
        caseId: fileDoc.caseId,
        filename: fileDoc.filename,
        originalName: fileDoc.originalName,
        mimeType: fileDoc.mimeType,
        fileCategory: fileDoc.fileCategory,
        sizeBytes: fileDoc.sizeBytes,
        sha256Hash: fileDoc.sha256Hash,
        uploadedAt: fileDoc.uploadedAt
      });
    }

    // Update case file count
    await CaseService.incrementFileCount(caseId, files.length);

    return uploadedResults;
  }

  /**
   * List files for a case (excluding soft-deleted)
   */
  static async listFilesForCase(caseId: string, category?: FileCategory) {
    const query: Record<string, unknown> = { caseId, isDeleted: false };
    if (category) {
      query.fileCategory = category;
    }

    return FileModel.find(query).sort({ uploadedAt: -1 }).lean();
  }

  /**
   * Get file record by ID
   */
  static async getFileById(fileId: string): Promise<IFileDocument | null> {
    return FileModel.findOne({ fileId, isDeleted: false });
  }

  /**
   * Soft-delete file from a case (FR-3.7)
   */
  static async deleteFile(
    fileId: string,
    userId: string,
    userEmail?: string
  ): Promise<void> {
    const file = await FileModel.findOne({ fileId, isDeleted: false });
    if (!file) {
      const err = new Error('File not found.');
      (err as any).status = 404;
      (err as any).code = 'FILE_NOT_FOUND';
      throw err;
    }

    const targetCase = await CaseModel.findOne({ caseId: file.caseId });
    if (targetCase && targetCase.status === 'Closed') {
      const err = new Error('Cannot delete files from a closed case.');
      (err as any).status = 403;
      (err as any).code = 'CASE_CLOSED';
      throw err;
    }

    file.isDeleted = true;
    file.deletedAt = new Date();
    await file.save();

    if (targetCase) {
      await CaseService.incrementFileCount(file.caseId, -1);
    }

    // Audit file deletion (FR-7.1)
    await AuditService.logAction({
      userId,
      userEmail,
      action: 'FILE_DELETE',
      targetType: 'FILE',
      targetId: fileId,
      caseId: file.caseId,
      details: {
        filename: file.originalName,
        sha256Hash: file.sha256Hash
      }
    });
  }
}
