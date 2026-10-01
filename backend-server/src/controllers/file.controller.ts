import type { Request, Response, NextFunction } from 'express';
import { FileService } from '../services/file.service.ts';
import { ForensicsService } from '../services/forensics.service.ts';
import { sendSuccess, sendError } from '../utils/apiResponse.ts';
import type { FileCategory } from '../types/file.types.ts';

export class FileController {
  static async uploadFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const files = req.files as Express.Multer.File[];
      const userId = req.user!.userId;
      const userEmail = req.user?.email;

      if (!files || files.length === 0) {
        sendError(res, 400, 'NO_FILES_UPLOADED', 'Please select at least one file to upload.');
        return;
      }

      const uploadedFiles = await FileService.uploadFiles(caseId, files, userId, userEmail);

      // Auto-trigger forensic pipeline asynchronously for uploaded images (FR-4.8)
      for (const f of uploadedFiles) {
        if (f.fileCategory === 'image') {
          // Asynchronously trigger without blocking immediate upload response
          ForensicsService.analyzeFile(f.fileId, userId, userEmail).catch((err) => {
            console.error(`[Auto-Forensics] Background analysis failed for file ${f.fileId}:`, err);
          });
        }
      }

      sendSuccess(res, uploadedFiles, 201);
    } catch (error) {
      next(error);
    }
  }

  static async listFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const category = req.query.category as FileCategory | undefined;

      const files = await FileService.listFilesForCase(caseId, category);
      sendSuccess(res, files, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getFileById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const file = await FileService.getFileById(fileId);

      if (!file) {
        sendError(res, 404, 'FILE_NOT_FOUND', `File with ID '${fileId}' was not found.`);
        return;
      }

      sendSuccess(res, file, 200);
    } catch (error) {
      next(error);
    }
  }

  static async deleteFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const userId = req.user!.userId;
      const userEmail = req.user?.email;

      await FileService.deleteFile(fileId, userId, userEmail);
      sendSuccess(res, { message: 'File removed successfully (soft-deleted for audit retention).' }, 200);
    } catch (error) {
      next(error);
    }
  }
}
