import { Router } from 'express';
import { FileController } from '../controllers/file.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { upload } from '../middleware/upload.middleware.ts';

const router = Router();

// All file operations require authentication
router.use(requireAuth);

// Upload batch of files to a specific case (FR-3.1)
router.post('/cases/:caseId/files', upload.array('files', 10), FileController.uploadFiles);

// List files for a case
router.get('/cases/:caseId/files', FileController.listFiles);

// Get single file record
router.get('/files/:fileId', FileController.getFileById);

// Soft delete file (FR-3.7)
router.delete('/files/:fileId', FileController.deleteFile);

export default router;
