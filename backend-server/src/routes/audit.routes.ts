import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller.ts';
import { requireAuth, requireRoles } from '../middleware/auth.middleware.ts';
import { USER_ROLES } from '../config/constants.ts';

const router = Router();

router.use(requireAuth);

// Get case history (FR-7.2)
router.get('/cases/:caseId/history', AuditController.getCaseHistory);

// Get all audit logs
router.get('/audit-logs', requireRoles(USER_ROLES.SUPER_ADMIN), AuditController.getAuditLogs);

export default router;
