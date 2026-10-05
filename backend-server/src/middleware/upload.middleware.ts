import multer from 'multer';
import path from 'node:path';
import type { Request } from 'express';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  ALLOWED_AUDIO_MIME_TYPES,
  MAX_VIDEO_SIZE_BYTES,
  ALL_ALLOWED_EXTENSIONS
} from '../config/constants.ts';

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
  const isVideoMime = (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mime);
  const isAudioMime = (ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mime);
  const isAllowedExt = (ALL_ALLOWED_EXTENSIONS as readonly string[]).includes(ext);

  if (!isAllowedExt && !isImageMime && !isDocMime && !isVideoMime && !isAudioMime) {
    const error = new Error(
      `Unsupported file format '${ext || mime}'. Accepted formats: Images (JPEG, PNG, WEBP), Documents (PDF, DOCX, TXT), Video (MP4, MOV, AVI, MKV, MPEG, 3GP, WebM), and Audio (WAV, MP3, M4A/AAC, FLAC, AMR).`
    );
    (error as unknown as { code: string }).code = 'INVALID_FILE_TYPE';
    return cb(error);
  }

  cb(null, true);
};

export const upload = multer({
  storage,
  limits: {
    // Top-level limit set to 100MB; individual file size checked strictly per category in service (FR-3.3)
    fileSize: MAX_VIDEO_SIZE_BYTES,
    files: 20 // Max batch size
  },
  fileFilter
});
