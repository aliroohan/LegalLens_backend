import crypto from 'node:crypto';
import { CaseModel } from '../models/case.model.ts';
import { FileModel } from '../models/file.model.ts';
import { ForensicResultModel } from '../models/forensicResult.model.ts';
import { ReportModel, type IReportDocument } from '../models/report.model.ts';
import { AuditService } from './audit.service.ts';

export class ReportService {
  /**
   * Compile case forensic report summary data (FR-5.1 - FR-5.4)
   */
  static async generateCaseReportSummary(
    caseId: string,
    userId: string,
    userEmail?: string
  ): Promise<{ reportId: string; reportData: Record<string, unknown> }> {
    const caseData = await CaseModel.findOne({ caseId, isDeleted: false }).lean();
    if (!caseData) {
      const err = new Error('Case not found.');
      (err as any).status = 404;
      (err as any).code = 'CASE_NOT_FOUND';
      throw err;
    }

    const files = await FileModel.find({ caseId, isDeleted: false }).lean();
    const forensicResults = await ForensicResultModel.find({ caseId }).sort({ analyzedAt: -1 }).lean();

    // Map files with their latest forensic results
    const imageReports = files
      .filter((f) => f.fileCategory === 'image')
      .map((imgFile) => {
        const forensic = forensicResults.find((r) => r.fileId === imgFile.fileId);
        return {
          fileId: imgFile.fileId,
          filename: imgFile.originalName,
          sizeBytes: imgFile.sizeBytes,
          sha256Hash: imgFile.sha256Hash,
          uploadedAt: imgFile.uploadedAt,
          fusionScore: forensic ? forensic.fusionScore : null,
          authenticityLabel: forensic ? forensic.authenticityLabel : 'Pending Analysis',
          modules: forensic ? forensic.modules : null,
          weightsApplied: forensic ? forensic.weightsApplied : null
        };
      });

    const reportId = crypto.randomUUID();
    const summaryData = {
      reportId,
      caseMetadata: {
        caseId: caseData.caseId,
        caseName: caseData.caseName,
        clientName: caseData.clientName,
        matterType: caseData.matterType,
        status: caseData.status,
        description: caseData.description,
        createdAt: caseData.createdAt,
        lastActivityAt: caseData.lastActivityAt
      },
      totalFiles: files.length,
      analyzedImagesCount: imageReports.filter((r) => r.fusionScore !== null).length,
      images: imageReports,
      documents: files
        .filter((f) => f.fileCategory === 'document')
        .map((doc) => ({
          fileId: doc.fileId,
          filename: doc.originalName,
          sizeBytes: doc.sizeBytes,
          sha256Hash: doc.sha256Hash,
          uploadedAt: doc.uploadedAt
        })),
      generatedAt: new Date(),
      generatedBy: userId
    };

    // Retain report metadata under the case (FR-5.4)
    await ReportModel.create({
      reportId,
      caseId,
      generatedBy: userId,
      title: `Forensic Report - ${caseData.caseName}`,
      summary: summaryData
    });

    // Audit report export (FR-7.1)
    await AuditService.logAction({
      userId,
      userEmail,
      action: 'REPORT_EXPORT',
      targetType: 'REPORT',
      targetId: reportId,
      caseId,
      details: {
        caseName: caseData.caseName,
        totalImagesAnalyzed: summaryData.analyzedImagesCount
      }
    });

    return {
      reportId,
      reportData: summaryData
    };
  }

  /**
   * List reports generated for a case
   */
  static async listReportsForCase(caseId: string) {
    return ReportModel.find({ caseId }).sort({ createdAt: -1 }).lean();
  }
}
