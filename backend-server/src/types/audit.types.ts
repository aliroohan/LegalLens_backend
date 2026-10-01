import type { AuditAction, AuditTargetType } from '../config/constants.ts';

export interface IAuditLog {
  logId: string;
  userId: string;
  userEmail?: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  caseId?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  ipAddress?: string;
}

export interface CreateAuditLogDto {
  userId: string;
  userEmail?: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  caseId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}
