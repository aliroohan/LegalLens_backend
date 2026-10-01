import type { AuthenticityLabel } from '../config/constants.ts';

export type ForensicModuleStatus = 'success' | 'not_applicable' | 'failed';

export interface ModuleResult {
  status: ForensicModuleStatus;
  subScore: number | null; // 0.0 to 1.0 (null if not applicable)
  explanation: string;
  heatmapUrl?: string | null;
  heatmapBase64?: string | null;
  details?: Record<string, unknown>;
}

export interface IForensicResult {
  resultId: string;
  fileId: string;
  caseId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  fusionScore: number | null; // 0.00 to 1.00
  authenticityLabel: AuthenticityLabel | null;
  modules: {
    exif: ModuleResult;
    ela: ModuleResult;
    copyMove: ModuleResult;
    noise: ModuleResult;
    lighting: ModuleResult;
    deepfake: ModuleResult;
  };
  weightsApplied: Record<string, number>;
  errorMessage?: string;
  durationMs?: number;
  analyzedAt: Date;
  retriggeredCount: number;
}
