import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { sendError } from '../utils/apiResponse.ts';
import { logger } from '../utils/logger.ts';

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error('Unhandled server error:', err);

  // Multer Errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      sendError(res, 400, 'FILE_TOO_LARGE', 'File exceeds the allowed size limit (10MB for images, 25MB for documents).');
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      sendError(res, 400, 'TOO_MANY_FILES', 'Exceeded maximum number of files per batch upload (10 files max).');
      return;
    }
    sendError(res, 400, 'UPLOAD_ERROR', `File upload error: ${err.message}`);
    return;
  }

  // Custom File Type Error
  if (err?.code === 'INVALID_FILE_TYPE') {
    sendError(res, 400, 'UNSUPPORTED_FILE_TYPE', err.message);
    return;
  }

  // Generic or Custom Error
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  const errorMessage = err.message || 'An unexpected error occurred. Please try again.';

  sendError(res, statusCode, errorCode, errorMessage, err.details);
};
