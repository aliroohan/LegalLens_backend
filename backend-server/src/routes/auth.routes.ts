import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.ts';
import { validate } from '../middleware/validate.middleware.ts';
import { requireAuth, requireRoles } from '../middleware/auth.middleware.ts';
import {
  registerSchema,
  registerIndependentSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyBarIdSchema,
  adminResetPasswordSchema
} from '../validators/auth.validator.ts';
import { USER_ROLES } from '../config/constants.ts';

const router = Router();

// Public auth routes
router.post('/register', validate(registerSchema), AuthController.register);
router.post('/register-independent', validate(registerIndependentSchema), AuthController.registerIndependent);
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/forgot-password', validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), AuthController.resetPassword);

// Protected auth routes
router.post('/logout', requireAuth, AuthController.logout);
router.get('/me', requireAuth, AuthController.getMe);

// Bar ID verification endpoint (FR-1.5: Super Admin or Org Admin)
router.post(
  '/users/:userId/verify-bar-id',
  requireAuth,
  requireRoles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ORG_ADMIN),
  validate(verifyBarIdSchema),
  AuthController.verifyBarId
);

// Org Admin resets lawyer password (FR-1.12)
router.post(
  '/users/:userId/reset-password',
  requireAuth,
  requireRoles(USER_ROLES.ORG_ADMIN),
  validate(adminResetPasswordSchema),
  AuthController.adminResetUserPassword
);

export default router;
