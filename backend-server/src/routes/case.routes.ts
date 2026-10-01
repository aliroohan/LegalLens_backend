import { Router } from 'express';
import { CaseController } from '../controllers/case.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { validateBody, validateQuery } from '../middleware/validate.middleware.ts';
import {
  createCaseSchema,
  updateCaseSchema,
  deleteCaseConfirmationSchema,
  caseFilterQuerySchema
} from '../validators/case.validator.ts';

const router = Router();

// All case operations require authentication
router.use(requireAuth);

router.post('/', validateBody(createCaseSchema), CaseController.createCase);
router.get('/', validateQuery(caseFilterQuerySchema), CaseController.listCases);
router.get('/:caseId', CaseController.getCaseById);
router.patch('/:caseId', validateBody(updateCaseSchema), CaseController.updateCase);
router.delete('/:caseId', validateBody(deleteCaseConfirmationSchema), CaseController.deleteCase);

export default router;
