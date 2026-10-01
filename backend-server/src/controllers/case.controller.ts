import type { Request, Response, NextFunction } from 'express';
import { CaseService } from '../services/case.service.ts';
import { sendSuccess, sendError } from '../utils/apiResponse.ts';
import type { CaseFilterQueryInput } from '../validators/case.validator.ts';

export class CaseController {
  static async createCase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const userEmail = req.user?.email;
      const firmId = req.user?.firmId || 'firm_default';

      const { caseData, warning } = await CaseService.createCase(req.body, userId, userEmail, firmId);
      sendSuccess(res, caseData, 201, warning ? { warning } : undefined);
    } catch (error) {
      next(error);
    }
  }

  static async listCases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const firmId = req.user?.firmId || 'firm_default';
      const filters = req.query as unknown as CaseFilterQueryInput;

      const result = await CaseService.listCases(filters, firmId);
      sendSuccess(res, result.cases, 200, {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages
      });
    } catch (error) {
      next(error);
    }
  }

  static async getCaseById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const firmId = req.user?.firmId || 'firm_default';

      const caseData = await CaseService.getCaseById(caseId, firmId);
      if (!caseData) {
        sendError(res, 404, 'CASE_NOT_FOUND', `Case with ID '${caseId}' was not found.`);
        return;
      }
      sendSuccess(res, caseData, 200);
    } catch (error) {
      next(error);
    }
  }

  static async updateCase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const userId = req.user!.userId;
      const userEmail = req.user?.email;
      const firmId = req.user?.firmId || 'firm_default';

      const updated = await CaseService.updateCase(caseId, req.body, userId, userEmail, firmId);
      sendSuccess(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }

  static async deleteCase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const { confirmCaseName } = req.body;
      const userId = req.user!.userId;
      const userEmail = req.user?.email;
      const firmId = req.user?.firmId || 'firm_default';

      await CaseService.deleteCase(caseId, confirmCaseName, userId, userEmail, firmId);
      sendSuccess(res, { message: `Case '${confirmCaseName}' permanently deleted.` }, 200);
    } catch (error) {
      next(error);
    }
  }
}
