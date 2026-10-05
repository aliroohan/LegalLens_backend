import { z } from 'zod';
import { USER_ROLES, BAR_ID_STATUS } from '../config/constants.ts';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum([USER_ROLES.SUPER_ADMIN, USER_ROLES.ORG_ADMIN, USER_ROLES.LAWYER]).optional(),
  firmId: z.string().optional(),
  orgId: z.string().optional(),
  barId: z.string().optional(),
  isIndependent: z.boolean().optional()
});

export const registerIndependentSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  name: z.string().min(1, 'Full name is required'),
  barId: z.string().min(1, 'Bar ID is required for lawyer registration')
});

export const registerOrgLawyerSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Lawyer name is required'),
  barId: z.string().min(1, 'Bar ID is required'),
  password: z.string().min(6, 'Temporary password must be at least 6 characters long').optional()
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email address is required')
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters long')
});

export const verifyBarIdSchema = z.object({
  status: z.enum([BAR_ID_STATUS.VERIFIED, BAR_ID_STATUS.REJECTED]),
  notes: z.string().optional()
});

export const adminResetPasswordSchema = z.object({
  newPassword: z.string().min(6, 'New password must be at least 6 characters long').optional()
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type RegisterIndependentInput = z.infer<typeof registerIndependentSchema>;
export type RegisterOrgLawyerInput = z.infer<typeof registerOrgLawyerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyBarIdInput = z.infer<typeof verifyBarIdSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
