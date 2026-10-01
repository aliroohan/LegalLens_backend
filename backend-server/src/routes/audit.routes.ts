import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

const router = Router();

router.use(requireAuth);

// Get case history (FR-7.2)
router.get('/cases/:caseId/history', AuditController.getCaseHistory);

// Get all audit logs
router.get('/audit-logs', AuditController.getAuditLogs);

export default router;
