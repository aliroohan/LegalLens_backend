import multer from 'multer';
import path from 'node:path';
import type { Request } from 'express';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_DOCUMENT_SIZE_BYTES
} from '../config/constants.ts';

// Allowed extensions map for friendly messages
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.doc', '.txt'];

// Use memory storage so we can compute SHA-256 and cleanly write original + working copy
const storage = multer.memoryStorage();

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();

  const isImageMime = (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
  const isDocMime = (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime);
  const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);

  if (!isAllowedExt || (!isImageMime && !isDocMime)) {
    const error = new Error(
      `Unsupported file format '${ext || mime}'. Accepted formats: Images (JPEG, PNG, WEBP) and Documents (PDF, DOCX, TXT).`
    );
    (error as unknown as { code: string }).code = 'INVALID_FILE_TYPE';
    return cb(error);
  }

  cb(null, true);
};

export const upload = multer({
  storage,
  limits: {
    // Top-level limit to max document size; individual file size checked strictly in service
    fileSize: MAX_DOCUMENT_SIZE_BYTES,
    files: 10 // Max batch size
  },
  fileFilter
});
