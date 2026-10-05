import { Router } from 'express';
import { ReportController } from '../controllers/report.controller.ts';
import {
  requireAuth,
  requireVerifiedBarId,
  restrictSuperAdminFromCases
} from '../middleware/auth.middleware.ts';

const router = Router();

router.use(requireAuth, requireVerifiedBarId, restrictSuperAdminFromCases);

// Export single PDF case report summary (FR-6.1 - FR-6.5)
router.post('/cases/:caseId/export', ReportController.exportCaseReport);

// List generated reports for case (FR-6.4)
router.get('/cases/:caseId/reports', ReportController.listCaseReports);

export default router;
