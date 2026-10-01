import type { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service.ts';
import { sendSuccess } from '../utils/apiResponse.ts';

export class AuditController {
  static async getCaseHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const history = await AuditService.getCaseHistory(caseId);
      sendSuccess(res, history, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId, action, targetId } = req.query as { userId?: string; action?: string; targetId?: string };
      const logs = await AuditService.getAuditLogs({ userId, action, targetId });
      sendSuccess(res, logs, 200);
    } catch (error) {
      next(error);
    }
  }
}
