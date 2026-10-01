import { Router } from 'express';
import { ReportController } from '../controllers/report.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

const router = Router();

router.use(requireAuth);

// Export single PDF case report summary (FR-5.1 - FR-5.4)
router.post('/cases/:caseId/export', ReportController.exportCaseReport);

// List generated reports for case
router.get('/cases/:caseId/reports', ReportController.listCaseReports);

export default router;
