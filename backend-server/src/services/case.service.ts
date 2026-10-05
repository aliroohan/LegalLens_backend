import crypto from 'node:crypto';
import { CaseModel, type ICaseDocument } from '../models/case.model.ts';
import { FileModel } from '../models/file.model.ts';
import { ForensicResultModel } from '../models/forensicResult.model.ts';
import type { CreateCaseInput, UpdateCaseInput, CaseFilterQueryInput } from '../validators/case.validator.ts';
import type { ICase } from '../types/case.types.ts';
import { AuditService } from './audit.service.ts';

export class CaseService {
  /**
   * Create a new case (FR-2.1, FR-2.7)
   */
  static async createCase(
    input: CreateCaseInput,
    userId: string,
    userEmail?: string,
    firmId = 'firm_default'
  ): Promise<{ caseData: ICase; warning?: string }> {
    // Check for duplicate client case names within the same firm (FR-2.7: warn, not block)
    const existingDuplicate = await CaseModel.findOne({
      firmId,
      clientName: new RegExp(`^${input.clientName.trim()}$`, 'i'),
      caseName: new RegExp(`^${input.caseName.trim()}$`, 'i'),
      isDeleted: false
    });

    let warning: string | undefined;
    if (existingDuplicate) {
      warning = `Warning: A case with the name '${input.caseName}' already exists for client '${input.clientName}'.`;
    }

    const caseId = crypto.randomUUID();
    const newCase = await CaseModel.create({
      caseId,
      caseName: input.caseName.trim(),
      clientName: input.clientName.trim(),
      matterType: input.matterType,
      description: input.description?.trim() || '',
      status: 'Open',
      fileCount: 0,
      lastActivityAt: new Date(),
      createdBy: userId,
      firmId,
      isDeleted: false
    });

    // Audit case creation (FR-7.1)
    await AuditService.logAction({
      userId,
      userEmail,
      action: 'CASE_CREATE',
      targetType: 'CASE',
      targetId: caseId,
      caseId,
      details: {
        caseName: newCase.caseName,
        clientName: newCase.clientName,
        matterType: newCase.matterType
      }
    });

    return {
      caseData: newCase.toObject() as ICase,
      warning
    };
  }

  /**
   * List cases with filtering, pagination and sorting (FR-2.2)
   */
  static async listCases(
    filters: CaseFilterQueryInput,
    firmId = 'firm_default'
  ): Promise<{ cases: ICase[]; total: number; page: number; totalPages: number }> {
    const query: Record<string, unknown> = {
      firmId,
      isDeleted: false
    };

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.matterType) {
      query.matterType = filters.matterType;
    }

    if (filters.clientName) {
      query.clientName = new RegExp(filters.clientName, 'i');
    }

    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      query.$or = [{ caseName: searchRegex }, { clientName: searchRegex }];
    }

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const sortField = filters.sortBy || 'lastActivityAt';
    const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };

    const [cases, total] = await Promise.all([
      CaseModel.find(query).sort(sort).skip(skip).limit(limit).lean(),
      CaseModel.countDocuments(query)
    ]);

    return {
      cases: cases as unknown as ICase[],
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Get case detail by ID (FR-2.3)
   */
  static async getCaseById(caseId: string, firmId = 'firm_default'): Promise<ICase | null> {
    const caseDoc = await CaseModel.findOne({ caseId, firmId, isDeleted: false }).lean();
    return (caseDoc as unknown as ICase) || null;
  }

  /**
   * Update case metadata (FR-2.4, FR-2.5)
   */
  static async updateCase(
    caseId: string,
    input: UpdateCaseInput,
    userId: string,
    userEmail?: string,
    firmId = 'firm_default'
  ): Promise<ICase> {
    const existingCase = await CaseModel.findOne({ caseId, firmId, isDeleted: false });
    if (!existingCase) {
      const err = new Error('Case not found.');
      (err as any).status = 404;
      (err as any).code = 'CASE_NOT_FOUND';
      throw err;
    }

    // Closed cases become read-only (FR-2.5) except for reopening or status transition
    if (existingCase.status === 'Closed' && input.status === undefined) {
      const err = new Error('Cannot edit a closed case. Re-open the case first.');
      (err as any).status = 403;
      (err as any).code = 'CASE_CLOSED_READONLY';
      throw err;
    }

    const previousValues: Record<string, unknown> = {};
    const updatedValues: Record<string, unknown> = {};

    if (input.caseName !== undefined && input.caseName !== existingCase.caseName) {
      previousValues.caseName = existingCase.caseName;
      existingCase.caseName = input.caseName.trim();
      updatedValues.caseName = existingCase.caseName;
    }

    if (input.clientName !== undefined && input.clientName !== existingCase.clientName) {
      previousValues.clientName = existingCase.clientName;
      existingCase.clientName = input.clientName.trim();
      updatedValues.clientName = existingCase.clientName;
    }

    if (input.matterType !== undefined && input.matterType !== existingCase.matterType) {
      previousValues.matterType = existingCase.matterType;
      existingCase.matterType = input.matterType;
      updatedValues.matterType = existingCase.matterType;
    }

    if (input.description !== undefined && input.description !== existingCase.description) {
      previousValues.description = existingCase.description;
      existingCase.description = input.description.trim();
      updatedValues.description = existingCase.description;
    }

    let isClosingAction = false;
    if (input.status !== undefined && input.status !== existingCase.status) {
      previousValues.status = existingCase.status;
      existingCase.status = input.status;
      updatedValues.status = existingCase.status;
      if (input.status === 'Closed') {
        existingCase.closedAt = new Date();
        isClosingAction = true;
      } else {
        existingCase.closedAt = undefined;
      }
    }

    existingCase.lastActivityAt = new Date();
    await existingCase.save();

    // Audit log edit (FR-2.4, FR-7.1)
    await AuditService.logAction({
      userId,
      userEmail,
      action: isClosingAction ? 'CASE_CLOSE' : 'CASE_UPDATE',
      targetType: 'CASE',
      targetId: caseId,
      caseId,
      details: {
        previous: previousValues,
        updated: updatedValues
      }
    });

    return existingCase.toObject() as ICase;
  }

  /**
   * Permanently delete a case (FR-2.6)
   * Only allowed if case is already Closed, requires typed case name confirmation.
   */
  static async deleteCase(
    caseId: string,
    confirmCaseName: string,
    userId: string,
    userEmail?: string,
    firmId = 'firm_default'
  ): Promise<void> {
    const existingCase = await CaseModel.findOne({ caseId, firmId, isDeleted: false });
    if (!existingCase) {
      const err = new Error('Case not found.');
      (err as any).status = 404;
      (err as any).code = 'CASE_NOT_FOUND';
      throw err;
    }

    if (existingCase.status !== 'Closed') {
      const err = new Error('A case can only be permanently deleted if it is already Closed.');
      (err as any).status = 400;
      (err as any).code = 'CASE_NOT_CLOSED';
      throw err;
    }

    if (confirmCaseName.trim() !== existingCase.caseName.trim()) {
      const err = new Error('Case name confirmation does not match. Deletion aborted.');
      (err as any).status = 400;
      (err as any).code = 'CONFIRMATION_MISMATCH';
      throw err;
    }

    // Audit log BEFORE deleting record as required by FR-2.6
    await AuditService.logAction({
      userId,
      userEmail,
      action: 'CASE_DELETE',
      targetType: 'CASE',
      targetId: caseId,
      caseId,
      details: {
        deletedCaseName: existingCase.caseName,
        clientName: existingCase.clientName
      }
    });

    // Mark case as deleted
    existingCase.isDeleted = true;
    await existingCase.save();

    // Also mark associated files as deleted
    await FileModel.updateMany({ caseId }, { isDeleted: true, deletedAt: new Date() });
  }

  /**
   * Increment file count and touch last activity
   */
  static async incrementFileCount(caseId: string, incrementBy = 1): Promise<void> {
    await CaseModel.updateOne(
      { caseId },
      {
        $inc: { fileCount: incrementBy },
        $set: { lastActivityAt: new Date() }
      }
    );
  }

  /**
   * Refresh file count and touch last activity timestamp (FR-2.2)
   */
  static async touchCaseActivity(caseId: string): Promise<void> {
    const fileCount = await FileModel.countDocuments({ caseId, isDeleted: false });
    await CaseModel.updateOne(
      { caseId },
      {
        $set: { fileCount, lastActivityAt: new Date() }
      }
    );
  }
}
