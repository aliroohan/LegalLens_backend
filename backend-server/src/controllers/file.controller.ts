import type { Request, Response, NextFunction } from 'express';
import { FileService } from '../services/file.service.ts';
import { sendSuccess, sendError } from '../utils/apiResponse.ts';

export class FileController {
  static async uploadFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const files = req.files as Express.Multer.File[];
      const user = {
        userId: req.user!.userId,
        userEmail: req.user?.email,
        orgId: req.user?.orgId || req.user?.firmId,
        isIndependent: req.user?.isIndependent ?? false
      };

      if (!files || files.length === 0) {
        sendError(res, 400, 'NO_FILES_UPLOADED', 'Please select at least one file to upload.');
        return;
      }

      const uploadedFiles = await FileService.uploadFiles(caseId, files, user);
      sendSuccess(res, uploadedFiles, 201);
    } catch (error) {
      next(error);
    }
  }

  static async listFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const files = await FileService.listFilesForCase(caseId);
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

  /**
   * In-browser preview streaming for images, documents, and videos (FR-3.8)
   */
  static async previewFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const { stream, mimeType, filename, fileSize } = await FileService.getFilePreviewStream(fileId);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  }

  static async deleteFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const user = {
        userId: req.user!.userId,
        userEmail: req.user?.email,
        orgId: req.user?.orgId || req.user?.firmId
      };

      await FileService.deleteFile(fileId, user);
      sendSuccess(res, { message: 'File soft-deleted successfully. Audit trail preserved.' }, 200);
    } catch (error) {
      next(error);
    }
  }
}
