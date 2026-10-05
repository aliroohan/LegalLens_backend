import { Router } from 'express';
import { FileController } from '../controllers/file.controller.ts';
import {
  requireAuth,
  requireVerifiedBarId,
  restrictSuperAdminFromCases
} from '../middleware/auth.middleware.ts';
import { upload } from '../middleware/upload.middleware.ts';

const router = Router();

// All file operations require authentication, verified bar ID, and exclude Super Admin from evidence
router.use(requireAuth, requireVerifiedBarId, restrictSuperAdminFromCases);

// Upload batch of files to a specific case (FR-3.1 - FR-3.6)
router.post('/cases/:caseId/files', upload.array('files', 20), FileController.uploadFiles);

// List files for a case (FR-3.9)
router.get('/cases/:caseId/files', FileController.listFiles);

// In-browser evidence preview stream (images, video, documents) (FR-3.8)
router.get('/files/:fileId/preview', FileController.previewFile);

// Get single file record
router.get('/files/:fileId', FileController.getFileById);

// Soft delete file (FR-3.7)
router.delete('/files/:fileId', FileController.deleteFile);

export default router;
