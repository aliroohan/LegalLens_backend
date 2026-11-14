import type { Request, Response, NextFunction } from 'express';
import { ReportService } from '../services/report.service.ts';
import { openStoredStream } from '../services/cloudinary.service.ts';
import { assertCaseAccess } from '../services/access.service.ts';
import { sendSuccess } from '../utils/apiResponse.ts';

export class ReportController {
  static async exportCaseReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      await assertCaseAccess(caseId, req.user!);
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
      await assertCaseAccess(caseId, req.user!);
      const reports = await ReportService.listReportsForCase(caseId);
      sendSuccess(res, reports, 200);
    } catch (error) {
      next(error);
    }
  }

  static async downloadReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const reportId = req.params.reportId as string;
      await assertCaseAccess(caseId, req.user!);
      const report = await ReportService.getReportFile(reportId, caseId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="legallens-${reportId}.pdf"`);
      const stream = await openStoredStream(report.reportPath as string);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  }
}
