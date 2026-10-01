import { z } from 'zod';
import { MATTER_TYPES, CASE_STATUS } from '../config/constants.ts';

export const createCaseSchema = z.object({
  caseName: z
    .string()
    .min(1, 'Case name is required')
    .max(120, 'Case name cannot exceed 120 characters'),
  clientName: z.string().min(1, 'Client name is required'),
  matterType: z.enum(MATTER_TYPES, {
    errorMap: () => ({ message: `Matter type must be one of: ${MATTER_TYPES.join(', ')}` })
  }),
  description: z
    .string()
    .max(1000, 'Description cannot exceed 1000 characters')
    .optional()
    .default('')
});

export const updateCaseSchema = z.object({
  caseName: z
    .string()
    .min(1, 'Case name cannot be empty')
    .max(120, 'Case name cannot exceed 120 characters')
    .optional(),
  clientName: z.string().min(1, 'Client name cannot be empty').optional(),
  matterType: z.enum(MATTER_TYPES).optional(),
  description: z.string().max(1000, 'Description cannot exceed 1000 characters').optional(),
  status: z.enum(CASE_STATUS).optional()
});

export const deleteCaseConfirmationSchema = z.object({
  confirmCaseName: z.string().min(1, 'Typed case name is required for confirmation')
});

export const caseFilterQuerySchema = z.object({
  status: z.enum(CASE_STATUS).optional(),
  matterType: z.enum(MATTER_TYPES).optional(),
  clientName: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  sortBy: z.enum(['lastActivityAt', 'createdAt', 'caseName']).optional().default('lastActivityAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;
export type DeleteCaseConfirmationInput = z.infer<typeof deleteCaseConfirmationSchema>;
export type CaseFilterQueryInput = z.infer<typeof caseFilterQuerySchema>;
