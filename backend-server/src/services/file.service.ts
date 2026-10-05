import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { FileModel, type IFileDocument } from '../models/file.model.ts';
import { CaseModel } from '../models/case.model.ts';
import { ENV } from '../config/env.ts';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  ALLOWED_AUDIO_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_AUDIO_SIZE_BYTES,
  MAX_DOCUMENT_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  FILE_PROCESSING_STATUS
} from '../config/constants.ts';
import { computeSha256 } from '../utils/hash.ts';
import type { UploadedFileResponse, FileCategory } from '../types/file.types.ts';
import { AuditService } from './audit.service.ts';
import { CaseService } from './case.service.ts';
import { OrganizationService } from './organization.service.ts';
import { ForensicsService } from './forensics.service.ts';
import { logger } from '../utils/logger.ts';

export class FileService {
  /**
   * Determine file category from MIME type
   */
  private static determineCategory(mime: string): FileCategory {
    const m = mime.toLowerCase();
    if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(m)) return 'image';
    if ((ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(m)) return 'document';
    if ((ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(m)) return 'video';
    if ((ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(m)) return 'audio';
    return 'document';
  }

  /**
   * Get size limit per category (FR-3.3)
   */
  private static getCategorySizeLimit(category: FileCategory): number {
    switch (category) {
      case 'image':
        return MAX_IMAGE_SIZE_BYTES; // 5MB
      case 'audio':
        return MAX_AUDIO_SIZE_BYTES; // 5MB
      case 'document':
        return MAX_DOCUMENT_SIZE_BYTES; // 25MB
      case 'video':
        return MAX_VIDEO_SIZE_BYTES; // 100MB
    }
  }

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
   * Process and save a batch of uploaded files (FR-3.1 - FR-3.7, FR-2.7, FR-4.8)
   */
  static async uploadFiles(
    caseId: string,
    files: Express.Multer.File[],
    user: { userId: string; userEmail?: string; orgId?: string; isIndependent: boolean }
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

    // 1. Calculate total bytes in this batch
    const totalBatchBytes = files.reduce((sum, f) => sum + f.size, 0);

    // 2. Check storage quota before proceeding (FR-2.7, FR-8.1, FR-9.6)
    await OrganizationService.checkStorageAvailable(user, totalBatchBytes);

    const { originalsDir, workingDir } = await this.ensureDirectories(caseId);
    const uploadedResults: UploadedFileResponse[] = [];

    for (const file of files) {
      const fileCategory = this.determineCategory(file.mimetype);
      const maxAllowedSize = this.getCategorySizeLimit(fileCategory);

      // Validate size per category (FR-3.3, FR-8.1)
      if (file.size > maxAllowedSize) {
        const readableLimit =
          fileCategory === 'video'
            ? '100MB'
            : fileCategory === 'document'
            ? '25MB'
            : '5MB';
        const err = new Error(
          `File '${file.originalname}' exceeds the maximum allowed size of ${readableLimit} for ${fileCategory} files.`
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

      // Create working copy for any processing/forensics (FR-3.4)
      await fs.writeFile(workingStoragePath, file.buffer);

      const processingStatus =
        fileCategory === 'image' ? FILE_PROCESSING_STATUS.PENDING : FILE_PROCESSING_STATUS.NOT_APPLICABLE;

      // Persist file record (FR-3.6, FR-3.9)
      const fileDoc = await FileModel.create({
        fileId,
        caseId,
        filename: safeFilename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileCategory,
        sizeBytes: file.size,
        uploaderId: user.userId,
        orgId: user.orgId,
        sha256Hash,
        storagePath: originalStoragePath,
        workingCopyPath: workingStoragePath,
        processingStatus,
        isDeleted: false,
        uploadedAt: new Date()
      });

      // Increment pooled/user used storage (FR-2.7)
      await OrganizationService.incrementUsedStorage(user, file.size);

      // Audit file upload (FR-7.1)
      await AuditService.logAction({
        userId: user.userId,
        userEmail: user.userEmail,
        action: 'FILE_UPLOAD',
        targetType: 'FILE',
        targetId: fileId,
        caseId,
        details: {
          originalName: file.originalname,
          sizeBytes: file.size,
          mimeType: file.mimetype,
          fileCategory,
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
        processingStatus: fileDoc.processingStatus,
        uploadedAt: fileDoc.uploadedAt
      });

      // FR-4.8: Auto-trigger forensic analysis asynchronously if image
      if (fileCategory === 'image') {
        setImmediate(async () => {
          try {
            await ForensicsService.analyzeFile(
              fileId,
              user.userId,
              user.userEmail,
              undefined,
              user.orgId
            );
          } catch (forensicErr) {
            logger.error(`[FileService] Automatic forensic run failed for ${fileId}:`, forensicErr);
          }
        });
      }
    }

    // Update case file count and activity timestamp
    await CaseService.touchCaseActivity(caseId);

    return uploadedResults;
  }

  /**
   * List files for a case (excluding soft-deleted)
   */
  static async listFilesForCase(caseId: string): Promise<IFileDocument[]> {
    return FileModel.find({ caseId, isDeleted: false }).sort({ uploadedAt: -1 });
  }

  /**
   * Get single file record
   */
  static async getFileById(fileId: string): Promise<IFileDocument | null> {
    return FileModel.findOne({ fileId, isDeleted: false });
  }

  /**
   * Stream file for in-browser preview without altering original (FR-3.8)
   */
  static async getFilePreviewStream(fileId: string): Promise<{
    stream: NodeJS.ReadableStream;
    mimeType: string;
    filename: string;
    fileSize: number;
  }> {
    const file = await FileModel.findOne({ fileId, isDeleted: false });
    if (!file) {
      const err = new Error('File not found for preview.');
      (err as any).status = 404;
      (err as any).code = 'FILE_NOT_FOUND';
      throw err;
    }

    // Always stream from working copy if available, else original (FR-3.8: never touches or modifies original)
    const previewPath = file.workingCopyPath || file.storagePath;
    const stats = statSync(previewPath);
    const stream = createReadStream(previewPath);

    return {
      stream,
      mimeType: file.mimeType,
      filename: file.originalName,
      fileSize: stats.size
    };
  }

  /**
   * Soft-delete an uploaded file from a case (FR-3.7)
   */
  static async deleteFile(
    fileId: string,
    user: { userId: string; userEmail?: string; orgId?: string }
  ): Promise<void> {
    const file = await FileModel.findOne({ fileId, isDeleted: false });
    if (!file) {
      const err = new Error('File not found or already deleted.');
      (err as any).status = 404;
      (err as any).code = 'FILE_NOT_FOUND';
      throw err;
    }

    // Check if parent case is closed
    const parentCase = await CaseModel.findOne({ caseId: file.caseId, isDeleted: false });
    if (parentCase && parentCase.status === 'Closed') {
      const err = new Error('Cannot delete files from a closed case.');
      (err as any).status = 403;
      (err as any).code = 'CASE_CLOSED';
      throw err;
    }

    // Soft delete: set flag to true, keep file in storage for chain-of-custody (FR-3.7, NFR Data Retention)
    file.isDeleted = true;
    file.deletedAt = new Date();
    await file.save();

    // Release allocated storage back to organization/user
    await OrganizationService.decrementUsedStorage(user, file.sizeBytes);

    // Audit file deletion (FR-7.1)
    await AuditService.logAction({
      userId: user.userId,
      userEmail: user.userEmail,
      action: 'FILE_DELETE',
      targetType: 'FILE',
      targetId: fileId,
      caseId: file.caseId,
      details: {
        originalName: file.originalName,
        sizeBytes: file.sizeBytes,
        sha256Hash: file.sha256Hash
      }
    });

    await CaseService.touchCaseActivity(file.caseId);
  }
}
