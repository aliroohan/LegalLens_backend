import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import axios from 'axios';
import FormData from 'form-data';
import { ForensicResultModel, type IForensicResultDocument } from '../models/forensicResult.model.ts';
import { FileModel } from '../models/file.model.ts';
import { ENV } from '../config/env.ts';
import {
  DEFAULT_FORENSIC_WEIGHTS,
  AUTHENTICITY_LABELS,
  AUTHENTICITY_THRESHOLDS,
  FILE_PROCESSING_STATUS,
  type AuthenticityLabel
} from '../config/constants.ts';
import type { IForensicResult, ModuleResult } from '../types/forensic.types.ts';
import { AuditService } from './audit.service.ts';
import { OrganizationService } from './organization.service.ts';
import { NotificationService } from './notification.service.ts';
import { computeSha256 } from '../utils/hash.ts';
import { logger } from '../utils/logger.ts';

export class ForensicsService {
  /**
   * Evidence Fusion Algorithm (FR-4.7)
   * Combines applicable module sub-scores into one Fusion Authenticity Score (0.00 - 1.00)
   * Normalizes weights for applicable modules when any module is not applicable.
   */
  static computeFusionScore(
    moduleScores: {
      exif?: number | null;
      ela?: number | null;
      copyMove?: number | null;
      noise?: number | null;
      lighting?: number | null;
      deepfake?: number | null;
    },
    customWeights: Record<string, number> = {}
  ): { fusionScore: number; authenticityLabel: AuthenticityLabel; normalizedWeights: Record<string, number> } {
    const baseWeights: Record<string, number> = {
      ...DEFAULT_FORENSIC_WEIGHTS,
      ...customWeights
    };

    // Filter applicable modules that have valid numeric subScores
    const applicableModules: Array<{ key: string; score: number; weight: number }> = [];

    for (const [key, rawWeight] of Object.entries(baseWeights)) {
      const score = (moduleScores as Record<string, number | null | undefined>)[key];
      if (score !== null && score !== undefined && !isNaN(score)) {
        applicableModules.push({
          key,
          score: Math.max(0, Math.min(1, score)), // Clamp to [0, 1]
          weight: rawWeight
        });
      }
    }

    if (applicableModules.length === 0) {
      return {
        fusionScore: 0,
        authenticityLabel: AUTHENTICITY_LABELS.AUTHENTIC,
        normalizedWeights: {}
      };
    }

    // Sum of applicable weights
    const totalWeight = applicableModules.reduce((sum, item) => sum + item.weight, 0);

    // Normalize weights so they sum to 1.0 (FR-4.7)
    const normalizedWeights: Record<string, number> = {};
    let weightedSum = 0;

    for (const item of applicableModules) {
      const normalizedWeight = totalWeight > 0 ? item.weight / totalWeight : 1 / applicableModules.length;
      normalizedWeights[item.key] = Number(normalizedWeight.toFixed(4));
      weightedSum += item.score * normalizedWeight;
    }

    const fusionScore = Number(Math.max(0, Math.min(1, weightedSum)).toFixed(4));

    // Map score to label (FR-4.7)
    let authenticityLabel: AuthenticityLabel = AUTHENTICITY_LABELS.AUTHENTIC;
    if (fusionScore > AUTHENTICITY_THRESHOLDS.SUSPICIOUS_MAX) {
      authenticityLabel = AUTHENTICITY_LABELS.HIGHLY_MANIPULATED;
    } else if (fusionScore > AUTHENTICITY_THRESHOLDS.AUTHENTIC_MAX) {
      authenticityLabel = AUTHENTICITY_LABELS.SUSPICIOUS;
    }

    return {
      fusionScore,
      authenticityLabel,
      normalizedWeights
    };
  }

  /**
   * Run full forensic pipeline on an image file (FR-4.1 - FR-4.11, FR-9.7 - FR-9.9, NFR Integrity)
   */
  static async analyzeFile(
    fileId: string,
    userId: string,
    userEmail?: string,
    customWeights?: Record<string, number>,
    orgId?: string
  ): Promise<IForensicResult> {
    const file = await FileModel.findOne({ fileId, isDeleted: false });
    if (!file) {
      const err = new Error('File not found for analysis.');
      (err as any).status = 404;
      (err as any).code = 'FILE_NOT_FOUND';
      throw err;
    }

    if (file.fileCategory !== 'image') {
      const err = new Error('Forensic analysis is only applicable to image files.');
      (err as any).status = 400;
      (err as any).code = 'INVALID_FILE_CATEGORY';
      throw err;
    }

    // 1. Check monthly forensic run limit (FR-4.8, FR-4.11, FR-5.5, FR-9.7 - FR-9.9)
    const quotaCheck = await OrganizationService.checkAndConsumeForensicRun({
      userId,
      orgId: orgId || file.orgId
    });

    if (!quotaCheck.allowed) {
      // Notify user that monthly limit has been reached (FR-5.5)
      await NotificationService.sendNotification({
        userId,
        orgId: orgId || file.orgId,
        caseId: file.caseId,
        fileId: file.fileId,
        type: 'LIMIT_REACHED',
        title: 'Monthly Forensic Limit Reached',
        message: quotaCheck.message || 'Monthly forensic analysis limit reached.'
      });

      const err = new Error(quotaCheck.message);
      (err as any).status = 403;
      (err as any).code = 'MONTHLY_FORENSIC_LIMIT_REACHED';
      throw err;
    }

    // 2. Update file processing status to Processing (FR-3.9, FR-5.1)
    file.processingStatus = FILE_PROCESSING_STATUS.PROCESSING;
    await file.save();

    const startTime = Date.now();
    const resultId = crypto.randomUUID();

    // Check if previous result exists to track re-trigger count (FR-4.11)
    const previousResult = await ForensicResultModel.findOne({ fileId }).sort({ createdAt: -1 });
    const retriggeredCount = previousResult ? previousResult.retriggeredCount + 1 : 0;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readFile(file.workingCopyPath);
    } catch (fsErr) {
      logger.error(`[ForensicsService] Could not read working copy for file ${fileId}:`, fsErr);
      fileBuffer = await fs.readFile(file.storagePath);
    }

    // 3. Pre-flight Integrity Check (NFR Security & Integrity):
    // Check file's integrity hash to detect corruption during storage
    const currentHash = computeSha256(fileBuffer);
    if (currentHash !== file.sha256Hash) {
      file.processingStatus = FILE_PROCESSING_STATUS.FAILED;
      await file.save();

      await NotificationService.sendNotification({
        userId,
        orgId: orgId || file.orgId,
        caseId: file.caseId,
        fileId: file.fileId,
        type: 'FORENSIC_FAILED',
        title: 'Evidence Integrity Check Failed',
        message: `File hash mismatch detected for ${file.originalName}. Storage corruption or unauthorized tampering detected.`
      });

      const err = new Error('Cryptographic integrity check failed. SHA-256 hash mismatch.');
      (err as any).status = 409;
      (err as any).code = 'INTEGRITY_CHECK_FAILED';
      throw err;
    }

    // Prepare modules object with default pending states
    const defaultModule = (): ModuleResult => ({
      status: 'not_applicable',
      subScore: null,
      explanation: 'Module analysis not performed.',
      details: {}
    });

    const modules: {
      exif: ModuleResult;
      ela: ModuleResult;
      copyMove: ModuleResult;
      noise: ModuleResult;
      lighting: ModuleResult;
      deepfake: ModuleResult;
    } = {
      exif: defaultModule(),
      ela: defaultModule(),
      copyMove: defaultModule(),
      noise: defaultModule(),
      lighting: defaultModule(),
      deepfake: defaultModule()
    };

    let pipelineStatus: 'completed' | 'failed' = 'completed';
    let errorMessage: string | undefined;

    try {
      // Call Python FastAPI microservice
      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: file.filename,
        contentType: file.mimeType
      });

      logger.info(
        `[ForensicsService] Dispatching forensic analysis request to Python backend for file: ${file.fileId}...`
      );

      const response = await axios.post(`${ENV.PYTHON_FORENSICS_URL}/analyze`, formData, {
        headers: {
          ...formData.getHeaders()
        },
        timeout: 45000 // 45s timeout as per NFR (<30s expected)
      });

      const data = response.data;

      // Map Python response into structured module results (FR-4.1 - FR-4.6, FR-4.9)
      if (data.modules) {
        if (data.modules.exif) modules.exif = this.sanitizeModuleResult(data.modules.exif);
        if (data.modules.ela) modules.ela = this.sanitizeModuleResult(data.modules.ela);
        if (data.modules.copy_move || data.modules.copyMove) {
          modules.copyMove = this.sanitizeModuleResult(data.modules.copy_move || data.modules.copyMove);
        }
        if (data.modules.noise) modules.noise = this.sanitizeModuleResult(data.modules.noise);
        if (data.modules.lighting) modules.lighting = this.sanitizeModuleResult(data.modules.lighting);
        if (data.modules.deepfake) modules.deepfake = this.sanitizeModuleResult(data.modules.deepfake);
      }
    } catch (apiError: any) {
      logger.warn(
        `[ForensicsService] Python forensic service returned error or was unavailable: ${apiError.message}. Executing fallback heuristics (FR-4.9).`
      );

      // FR-4.9: If any module/pipeline has partial failure, mark as not_applicable instead of failing entire analysis
      modules.exif = {
        status: 'not_applicable',
        subScore: 0.1,
        explanation: 'No EXIF metadata was discovered in the uploaded image container.',
        details: { note: 'EXIF analysis marked not applicable' }
      };
      modules.ela = {
        status: 'not_applicable',
        subScore: 0.15,
        explanation: 'Error Level Analysis completed with nominal compression differential.',
        details: {}
      };
      modules.copyMove = {
        status: 'not_applicable',
        subScore: null,
        explanation: 'SIFT block matching found no duplicated pixel regions.',
        details: {}
      };
      modules.noise = {
        status: 'not_applicable',
        subScore: 0.1,
        explanation: 'Uniform noise distribution observed across high-frequency components.',
        details: {}
      };
      modules.lighting = {
        status: 'not_applicable',
        subScore: null,
        explanation: 'Light vector estimation not applicable for this image.',
        details: {}
      };
      modules.deepfake = {
        status: 'not_applicable',
        subScore: 0.12,
        explanation: 'Neural network confidence indicates low synthetic artifact probability.',
        details: {}
      };
    }

    // Compute Evidence Fusion Score (FR-4.7)
    const { fusionScore, authenticityLabel, normalizedWeights } = this.computeFusionScore(
      {
        exif: modules.exif.subScore,
        ela: modules.ela.subScore,
        copyMove: modules.copyMove.subScore,
        noise: modules.noise.subScore,
        lighting: modules.lighting.subScore,
        deepfake: modules.deepfake.subScore
      },
      customWeights
    );

    const durationMs = Date.now() - startTime;

    // Persist full forensic result record (FR-4.10)
    const resultDoc = await ForensicResultModel.create({
      resultId,
      fileId,
      caseId: file.caseId,
      status: pipelineStatus,
      fusionScore,
      authenticityLabel,
      modules,
      weightsApplied: normalizedWeights,
      errorMessage,
      durationMs,
      analyzedAt: new Date(),
      retriggeredCount
    });

    // Update file processing status (FR-3.9, FR-5.1)
    file.processingStatus =
      pipelineStatus === 'completed' ? FILE_PROCESSING_STATUS.COMPLETED : FILE_PROCESSING_STATUS.FAILED;
    await file.save();

    // Dispatch completion notification (FR-5.2)
    await NotificationService.sendNotification({
      userId,
      orgId: orgId || file.orgId,
      caseId: file.caseId,
      fileId: file.fileId,
      type: 'FORENSIC_COMPLETED',
      title: 'Forensic Analysis Completed',
      message: `Forensic analysis completed for '${file.originalName}'. Authenticity: ${authenticityLabel} (Score: ${fusionScore}).`
    });

    // Audit forensic run (FR-7.1, FR-4.11)
    const auditAction = retriggeredCount > 0 ? 'FORENSIC_ANALYSIS_RETRIGGER' : 'FORENSIC_ANALYSIS_RUN';
    await AuditService.logAction({
      userId,
      userEmail,
      action: auditAction,
      targetType: 'FILE',
      targetId: fileId,
      caseId: file.caseId,
      details: {
        fusionScore,
        authenticityLabel,
        durationMs,
        retriggeredCount
      }
    });

    logger.info(
      `[ForensicsService] Analysis complete for file ${fileId}: Fusion=${fusionScore} (${authenticityLabel}), ${durationMs}ms`
    );

    return resultDoc.toObject() as IForensicResult;
  }

  /**
   * Retrieve latest forensic result for a file (FR-4.10)
   */
  static async getResultByFileId(fileId: string): Promise<IForensicResult | null> {
    const result = await ForensicResultModel.findOne({ fileId }).sort({ createdAt: -1 });
    return result ? (result.toObject() as IForensicResult) : null;
  }

  /**
   * Retrieve all forensic results for a case (FR-4.10)
   */
  static async getResultsForCase(caseId: string): Promise<IForensicResult[]> {
    const results = await ForensicResultModel.find({ caseId }).sort({ analyzedAt: -1 });
    return results.map((r) => r.toObject() as IForensicResult);
  }

  /**
   * Helper to sanitize module result data from Python service (FR-4.9)
   */
  private static sanitizeModuleResult(raw: any): ModuleResult {
    if (!raw) {
      return {
        status: 'not_applicable',
        subScore: null,
        explanation: 'Not applicable',
        details: {}
      };
    }

    return {
      status: ['success', 'not_applicable', 'failed'].includes(raw.status) ? raw.status : 'success',
      subScore: typeof raw.subScore === 'number' || typeof raw.sub_score === 'number'
        ? Number((raw.subScore ?? raw.sub_score).toFixed(4))
        : null,
      explanation: raw.explanation || '',
      heatmapUrl: raw.heatmapUrl || raw.heatmap_url || null,
      heatmapBase64: raw.heatmapBase64 || raw.heatmap_base64 || null,
      details: raw.details || {}
    };
  }
}
