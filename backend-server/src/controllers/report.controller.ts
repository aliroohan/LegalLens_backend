import type { Request, Response, NextFunction } from 'express';
import { ReportService } from '../services/report.service.ts';
import { sendSuccess } from '../utils/apiResponse.ts';

export class ReportController {
  static async exportCaseReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const userId = req.user!.userId;
      const userEmail = req.user?.email;

      const report = await ReportService.generateCaseReportSummary(caseId, userId, userEmail);
      sendSuccess(res, report, 200);
    } catch (error) {
      next(error);
    }
  }

  static async listCaseReports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const reports = await ReportService.listReportsForCase(caseId);
      sendSuccess(res, reports, 200);
    } catch (error) {
      next(error);
    }
  }
}
