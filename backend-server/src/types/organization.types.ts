import type { OrgStatus } from '../config/constants.ts';

export interface CreateOrganizationDto {
  name: string;
  adminEmail: string;
  adminName?: string;
  adminPassword?: string;
  maxUsers?: number;
  allocatedStorageBytes?: number;
  monthlyForensicLimit?: number;
}

export interface UpdateOrganizationDto {
  name?: string;
  maxUsers?: number;
  allocatedStorageBytes?: number;
  monthlyForensicLimit?: number;
  status?: OrgStatus;
}

export interface OrganizationResponse {
  orgId: string;
  name: string;
  adminEmail: string;
  adminUserId?: string;
  status: OrgStatus;
  maxUsers: number;
  allocatedStorageBytes: number;
  usedStorageBytes: number;
  remainingStorageBytes: number;
  monthlyForensicLimit: number;
  currentMonthForensicRuns: number;
  userCount?: number;
  createdAt: Date;
  updatedAt: Date;
}
