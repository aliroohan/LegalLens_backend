import { Router } from 'express';
import { ForensicsController } from '../controllers/forensics.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';
import { retriggerAnalysisSchema } from '../validators/forensic.validator.ts';

const router = Router();

router.use(requireAuth);

// Manually trigger or re-trigger forensic analysis for a specific file (FR-4.11)
router.post('/files/:fileId/analyze', validateBody(retriggerAnalysisSchema), ForensicsController.analyzeFile);

// Get forensic result for a single file (FR-4.10)
router.get('/files/:fileId/forensics', ForensicsController.getResultByFileId);

// Get all forensic results for a case
router.get('/cases/:caseId/forensics', ForensicsController.getResultsForCase);

export default router;
