import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.ts';
import { validateBody } from '../middleware/validate.middleware.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { registerSchema, loginSchema } from '../validators/auth.validator.ts';

const router = Router();

router.post('/register', validateBody(registerSchema), AuthController.register);
router.post('/login', validateBody(loginSchema), AuthController.login);
router.get('/me', requireAuth, AuthController.getMe);

export default router;
