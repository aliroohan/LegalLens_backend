import type { MatterType, CaseStatus } from '../config/constants.ts';

export interface ICase {
  caseId: string;
  caseName: string;
  clientName: string;
  matterType: MatterType;
  description?: string;
  status: CaseStatus;
  fileCount: number;
  lastActivityAt: Date;
  createdBy: string;
  firmId?: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  isDeleted: boolean;
}

export interface CreateCaseDto {
  caseName: string;
  clientName: string;
  matterType: MatterType;
  description?: string;
}

export interface UpdateCaseDto {
  caseName?: string;
  clientName?: string;
  matterType?: MatterType;
  description?: string;
  status?: CaseStatus;
}

export interface CaseFilterQuery {
  status?: CaseStatus;
  matterType?: MatterType;
  clientName?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'lastActivityAt' | 'createdAt' | 'caseName';
  sortOrder?: 'asc' | 'desc';
}
