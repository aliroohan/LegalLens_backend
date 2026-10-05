import type { UserRole, BarIdStatus } from '../config/constants.ts';

export interface AuthUserPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  orgId?: string;
  firmId?: string; // alias
  isIndependent?: boolean;
  barId?: string;
  barIdStatus?: BarIdStatus;
}

export interface UserResponse {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  orgId?: string;
  firmId?: string;
  isIndependent: boolean;
  barId?: string;
  barIdStatus: BarIdStatus;
  allocatedStorageBytes: number;
  usedStorageBytes: number;
  monthlyForensicLimit: number;
  currentMonthForensicRuns: number;
  isActive: boolean;
  createdAt: Date;
}

export interface LoginResponse {
  user: UserResponse;
  token: string;
}
