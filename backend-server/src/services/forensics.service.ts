import crypto from 'node:crypto';
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
      const { readStoredBytes } = await import('./cloudinary.service.ts');
      fileBuffer = await readStoredBytes(file.storagePath);
    } catch (readErr) {
      logger.error(`[ForensicsService] Could not read stored evidence for file ${fileId}:`, readErr);
      throw readErr;
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
      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: file.filename,
        contentType: file.mimeType
      });

      const baseUrl = ENV.PYTHON_FORENSICS_URL.replace(/\/$/, '');
      logger.info(
        `[ForensicsService] Dispatching analysis for file ${file.fileId} to ${baseUrl}/api/analyze`
      );

      const response = await axios.post(`${baseUrl}/api/analyze`, formData, {
        headers: {
          ...formData.getHeaders()
        },
        timeout: 45000
      });

      const mapped = this.mapPythonAnalyses(response.data?.analyses);
      modules.exif = mapped.exif;
      modules.ela = mapped.ela;
      modules.copyMove = mapped.copyMove;
      modules.noise = mapped.noise;
      modules.lighting = mapped.lighting;
      modules.deepfake = mapped.deepfake;
    } catch (apiError: any) {
      pipelineStatus = 'failed';
      errorMessage =
        apiError?.response?.data?.detail ||
        apiError?.message ||
        'Forensics service was unavailable.';
      logger.warn(
        `[ForensicsService] Python forensic service unavailable for file ${fileId}: ${errorMessage}`
      );

      const unavailable = (name: string): ModuleResult => ({
        status: 'not_applicable',
        subScore: null,
        explanation: `${name} was not run because the forensics service did not return a result.`,
        details: { reason: 'service_unavailable' }
      });
      modules.exif = unavailable('EXIF metadata');
      modules.ela = unavailable('Error Level Analysis');
      modules.copyMove = unavailable('Copy-move detection');
      modules.noise = unavailable('Noise analysis');
      modules.lighting = unavailable('Splicing detection');
      modules.deepfake = unavailable('Compression analysis');
    }

    const fusion = pipelineStatus === 'failed'
      ? { fusionScore: null as number | null, authenticityLabel: null as AuthenticityLabel | null, normalizedWeights: {} as Record<string, number> }
      : this.computeFusionScore(
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
    const { fusionScore, authenticityLabel, normalizedWeights } = fusion;

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

    if (pipelineStatus === 'failed') {
      await NotificationService.sendNotification({
        userId,
        orgId: orgId || file.orgId,
        caseId: file.caseId,
        fileId: file.fileId,
        type: 'FORENSIC_FAILED',
        title: 'Forensic Analysis Failed',
        message: `Forensic analysis could not be completed for '${file.originalName}'. ${errorMessage || 'The forensics service was unavailable.'}`
      });
    } else {
      await NotificationService.sendNotification({
        userId,
        orgId: orgId || file.orgId,
        caseId: file.caseId,
        fileId: file.fileId,
        type: 'FORENSIC_COMPLETED',
        title: 'Forensic Analysis Completed',
        message: `Forensic analysis completed for '${file.originalName}'. Authenticity: ${authenticityLabel} (Score: ${fusionScore}).`
      });
    }

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
   * Adapt the unchanged Python `/api/analyze` payload (`analyses`) into the Node module model.
   * Lighting and deepfake CNN slots stay honest: splicing and compression are stored under those
   * keys only with `sourceName` so the UI does not present them as CNN or lighting research.
   */
  static mapPythonAnalyses(analyses: Record<string, any> | undefined): {
    exif: ModuleResult;
    ela: ModuleResult;
    copyMove: ModuleResult;
    noise: ModuleResult;
    lighting: ModuleResult;
    deepfake: ModuleResult;
  } {
    const empty = (label: string): ModuleResult => ({
      status: 'not_applicable',
      subScore: null,
      explanation: `${label} was not returned by the forensics service.`,
      details: {}
    });

    if (!analyses || typeof analyses !== 'object') {
      return {
        exif: empty('EXIF metadata'),
        ela: empty('Error Level Analysis'),
        copyMove: empty('Copy-move detection'),
        noise: empty('Noise analysis'),
        lighting: empty('Splicing detection'),
        deepfake: empty('Compression analysis')
      };
    }

    return {
      exif: this.mapPythonModule(analyses.metadata, 'EXIF Metadata Analysis', true),
      ela: this.mapPythonModule(analyses.ela, 'Error Level Analysis'),
      copyMove: this.mapPythonModule(analyses.copy_move, 'Copy-Move Detection'),
      noise: this.mapPythonModule(analyses.noise, 'Noise Pattern Analysis'),
      lighting: this.mapPythonModule(analyses.splicing, 'Image Splicing Detection'),
      deepfake: this.mapPythonModule(analyses.compression, 'Compression Artifact Detection')
    };
  }

  private static mapPythonModule(raw: any, sourceName: string, isMetadata = false): ModuleResult {
    if (!raw || typeof raw !== 'object') {
      return {
        status: 'not_applicable',
        subScore: null,
        explanation: `${sourceName} was not returned by the forensics service.`,
        details: { sourceName }
      };
    }

    const findings = Array.isArray(raw.findings) ? raw.findings.filter((item: unknown) => typeof item === 'string') : [];
    const failed = findings.some((item: string) => /failed/i.test(item)) && raw.visualization == null && raw.confidence == null;
    const confidence = typeof raw.confidence === 'number' && !Number.isNaN(raw.confidence) ? raw.confidence : null;
    const clamped = confidence === null ? null : Number(Math.max(0, Math.min(1, confidence)).toFixed(4));

    let subScore = clamped;
    if (isMetadata && subScore === null) {
      const flags = Array.isArray(raw.flags) ? raw.flags : [];
      subScore = flags.length === 0 ? 0 : Number(Math.min(1, flags.length * 0.25).toFixed(4));
    }

    const explanation =
      findings.length > 0
        ? `${sourceName}: ${findings.join(' ')}`
        : `${sourceName} completed with no written findings.`;

    return {
      status: failed ? 'failed' : 'success',
      subScore: failed ? null : subScore,
      explanation,
      heatmapBase64: typeof raw.visualization === 'string' && raw.visualization.length > 0 ? raw.visualization : null,
      details: {
        sourceName,
        findings,
        flags: raw.flags || [],
        data: raw.data || {}
      }
    };
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
