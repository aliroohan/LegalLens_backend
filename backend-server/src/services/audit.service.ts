import crypto from 'node:crypto';
import { AuditLogModel } from '../models/auditLog.model.ts';
import type { CreateAuditLogDto } from '../types/audit.types.ts';
import { logger } from '../utils/logger.ts';

export class AuditService {
  /**
   * Log an immutable audit action
   */
  static async logAction(dto: CreateAuditLogDto): Promise<void> {
    try {
      const logId = crypto.randomUUID();
      await AuditLogModel.create({
        logId,
        userId: dto.userId,
        userEmail: dto.userEmail,
        action: dto.action,
        targetType: dto.targetType,
        targetId: dto.targetId,
        caseId: dto.caseId,
        details: dto.details || {},
        timestamp: new Date(),
        ipAddress: dto.ipAddress
      });
    } catch (error) {
      logger.error('[AuditService] Failed to record audit log:', error);
      // Audit failure shouldn't crash the main operation, but must be logged
    }
  }

  /**
   * Get audit history for a specific case (FR-7.2)
   */
  static async getCaseHistory(caseId: string) {
    return AuditLogModel.find({ caseId })
      .sort({ timestamp: -1 })
      .lean();
  }

  /**
   * Get all audit logs with optional filters
   */
  static async getAuditLogs(filter: { userId?: string; action?: string; targetId?: string }) {
    const query: Record<string, unknown> = {};
    if (filter.userId) query.userId = filter.userId;
    if (filter.action) query.action = filter.action;
    if (filter.targetId) query.targetId = filter.targetId;

    return AuditLogModel.find(query)
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
  }
}
