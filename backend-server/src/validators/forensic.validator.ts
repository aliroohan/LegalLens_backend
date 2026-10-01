import { z } from 'zod';

export const retriggerAnalysisSchema = z.object({
  fileId: z.string().uuid('Invalid file ID format').optional(),
  customWeights: z
    .object({
      exif: z.number().min(0).max(1).optional(),
      ela: z.number().min(0).max(1).optional(),
      copyMove: z.number().min(0).max(1).optional(),
      noise: z.number().min(0).max(1).optional(),
      lighting: z.number().min(0).max(1).optional(),
      deepfake: z.number().min(0).max(1).optional()
    })
    .optional()
});

export type RetriggerAnalysisInput = z.infer<typeof retriggerAnalysisSchema>;
