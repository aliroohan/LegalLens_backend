import { Router } from 'express';
import { OrganizationController } from '../controllers/organization.controller.ts';
import { requireAuth, requireRoles } from '../middleware/auth.middleware.ts';
import { validate } from '../middleware/validate.middleware.ts';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  updateUserQuotasSchema
} from '../validators/organization.validator.ts';
import { registerOrgLawyerSchema } from '../validators/auth.validator.ts';
import { USER_ROLES } from '../config/constants.ts';

const router = Router();

// All organization routes require authentication
router.use(requireAuth);

// ==========================================
// SUPER ADMIN GOVERNANCE (FR-1.1, FR-9.1 - FR-9.9)
// ==========================================
router.post(
  '/super-admin/organizations',
  requireRoles(USER_ROLES.SUPER_ADMIN),
  validate(createOrganizationSchema),
  OrganizationController.createOrganization
);

router.get(
  '/super-admin/organizations',
  requireRoles(USER_ROLES.SUPER_ADMIN),
  OrganizationController.listOrganizations
);

router.get(
  '/super-admin/organizations/:orgId',
  requireRoles(USER_ROLES.SUPER_ADMIN),
  OrganizationController.getOrganizationById
);

router.patch(
  '/super-admin/organizations/:orgId',
  requireRoles(USER_ROLES.SUPER_ADMIN),
  validate(updateOrganizationSchema),
  OrganizationController.updateOrganization
);

router.get(
  '/super-admin/storage-overview',
  requireRoles(USER_ROLES.SUPER_ADMIN),
  OrganizationController.getStorageOverview
);

router.patch(
  '/super-admin/users/:userId/quotas',
  requireRoles(USER_ROLES.SUPER_ADMIN),
  validate(updateUserQuotasSchema),
  OrganizationController.updateIndependentUserQuotas
);

// ==========================================
// ORG ADMIN WORKSPACE & LAWYERS (FR-1.2, FR-1.3, FR-9.4)
// ==========================================
router.get(
  '/organizations/my-org',
  requireRoles(USER_ROLES.ORG_ADMIN),
  OrganizationController.getMyOrganization
);

router.post(
  '/organizations/lawyers',
  requireRoles(USER_ROLES.ORG_ADMIN),
  validate(registerOrgLawyerSchema),
  OrganizationController.addLawyer
);

router.get(
  '/organizations/lawyers',
  requireRoles(USER_ROLES.ORG_ADMIN),
  OrganizationController.listLawyers
);

router.patch(
  '/organizations/lawyers/:userId',
  requireRoles(USER_ROLES.ORG_ADMIN),
  OrganizationController.updateLawyer
);

router.delete(
  '/organizations/lawyers/:userId',
  requireRoles(USER_ROLES.ORG_ADMIN),
  OrganizationController.removeLawyer
);

export default router;
