import crypto from 'node:crypto';
import { CaseModel } from '../models/case.model.ts';
import { FileModel } from '../models/file.model.ts';
import { ForensicResultModel } from '../models/forensicResult.model.ts';
import { ReportModel, type IReportDocument } from '../models/report.model.ts';
import { AuditService } from './audit.service.ts';
import { NotificationService } from './notification.service.ts';
import { buildTextPdf } from '../utils/simplePdf.ts';
import { uploadBuffer } from './cloudinary.service.ts';

export class ReportService {
  /**
   * Compile case forensic report summary data (FR-5.1 - FR-5.4)
   */
  static async generateCaseReportSummary(
    caseId: string,
    userId: string,
    userEmail?: string
  ): Promise<{ reportId: string; reportPath: string; reportData: Record<string, unknown> }> {
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

    const pdfLines = [
      `Case: ${caseData.caseName}`,
      `Client: ${caseData.clientName}`,
      `Matter: ${caseData.matterType}`,
      `Status: ${caseData.status}`,
      `Files: ${files.length}`,
      `Analyzed images: ${summaryData.analyzedImagesCount}`,
      '',
      ...imageReports.flatMap((image) => [
        `${image.filename} — ${image.authenticityLabel} (${image.fusionScore ?? 'n/a'})`,
        `SHA-256: ${image.sha256Hash}`
      ])
    ];
    const pdf = buildTextPdf(`LegalLens report — ${caseData.caseName}`, pdfLines);
    const uploaded = await uploadBuffer({
      buffer: pdf,
      folder: 'legallens/reports',
      publicId: reportId,
      resourceType: 'raw',
      mimeType: 'application/pdf',
      format: 'pdf'
    });
    const reportPath = uploaded.secure_url;

    // Retain report metadata under the case (FR-5.4)
    await ReportModel.create({
      reportId,
      caseId,
      generatedBy: userId,
      title: `Forensic Report - ${caseData.caseName}`,
      summary: summaryData,
      reportPath
    });

    await NotificationService.sendNotification({
      userId,
      caseId,
      type: 'REPORT_READY',
      title: 'Case report ready',
      message: `A report for '${caseData.caseName}' is ready to download.`
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
      reportPath,
      reportData: summaryData
    };
  }

  static async getReportFile(reportId: string, caseId: string) {
    const report = await ReportModel.findOne({ reportId, caseId }).lean();
    if (!report?.reportPath) {
      const err = new Error('Report file was not found.');
      (err as any).status = 404;
      (err as any).code = 'REPORT_NOT_FOUND';
      throw err;
    }
    return report;
  }

  /**
   * List reports generated for a case
   */
  static async listReportsForCase(caseId: string) {
    return ReportModel.find({ caseId }).sort({ createdAt: -1 }).lean();
  }
}
