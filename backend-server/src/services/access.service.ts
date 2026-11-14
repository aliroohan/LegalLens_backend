import { CaseModel } from '../models/case.model.ts';
import { FileModel, type IFileDocument } from '../models/file.model.ts';
import type { AuthUserPayload } from '../types/auth.types.ts';

export function resolveFirmId(user: AuthUserPayload): string {
  return user.orgId || user.firmId || (user.isIndependent ? user.userId : 'firm_default');
}

function notFound(message: string, code: string): Error {
  const err = new Error(message);
  (err as any).status = 404;
  (err as any).code = code;
  return err;
}

export async function assertCaseAccess(caseId: string, user: AuthUserPayload) {
  const firmId = resolveFirmId(user);
  const caseDoc = await CaseModel.findOne({ caseId, firmId, isDeleted: false });
  if (!caseDoc) {
    throw notFound('Case not found.', 'CASE_NOT_FOUND');
  }
  return caseDoc;
}

export async function assertFileAccess(fileId: string, user: AuthUserPayload): Promise<IFileDocument> {
  const file = await FileModel.findOne({ fileId, isDeleted: false });
  if (!file) {
    throw notFound('File not found.', 'FILE_NOT_FOUND');
  }
  await assertCaseAccess(file.caseId, user);
  return file;
}
