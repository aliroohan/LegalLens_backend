import { z } from 'zod';
import { ORG_STATUS } from '../config/constants.ts';

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  adminEmail: z.string().email('Valid admin email is required'),
  adminName: z.string().min(1, 'Admin name is required').optional(),
  adminPassword: z.string().min(6).optional(),
  maxUsers: z.number().int().min(1).optional(),
  allocatedStorageBytes: z.number().min(0).optional(),
  monthlyForensicLimit: z.number().int().min(0).optional()
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  maxUsers: z.number().int().min(1).optional(),
  allocatedStorageBytes: z.number().min(0).optional(),
  monthlyForensicLimit: z.number().int().min(0).optional(),
  status: z.enum([ORG_STATUS.ACTIVE, ORG_STATUS.SUSPENDED, ORG_STATUS.DEACTIVATED]).optional()
});

export const updateUserQuotasSchema = z.object({
  allocatedStorageBytes: z.number().min(0).optional(),
  monthlyForensicLimit: z.number().int().min(0).optional()
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type UpdateUserQuotasInput = z.infer<typeof updateUserQuotasSchema>;
