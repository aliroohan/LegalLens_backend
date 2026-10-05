import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OrganizationModel, type IOrganizationDocument } from '../models/organization.model.ts';
import { UserModel, type IUserDocument } from '../models/user.model.ts';
import {
  USER_ROLES,
  BAR_ID_STATUS,
  ORG_STATUS,
  DEFAULT_ORG_MAX_USERS,
  DEFAULT_ORG_STORAGE_BYTES,
  DEFAULT_ORG_MONTHLY_FORENSIC_LIMIT,
  DEFAULT_INDEPENDENT_STORAGE_BYTES,
  DEFAULT_INDEPENDENT_MONTHLY_FORENSIC_LIMIT
} from '../config/constants.ts';
import type {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationResponse
} from '../types/organization.types.ts';
import { AuditService } from './audit.service.ts';
import { logger } from '../utils/logger.ts';

export class OrganizationService {
  /**
   * Helper to format current month key (e.g., '2026-10')
   */
  private static getCurrentMonthKey(): string {
    return new Date().toISOString().slice(0, 7);
  }

  /**
   * Super Admin registers a new organization and provisions the Org Admin account (FR-1.1, FR-9.1)
   */
  static async createOrganization(
    dto: CreateOrganizationDto,
    superAdminId: string,
    superAdminEmail?: string
  ): Promise<{ organization: OrganizationResponse; adminCredentials: { email: string; tempPassword?: string } }> {
    const existingOrg = await OrganizationModel.findOne({
      adminEmail: dto.adminEmail.toLowerCase()
    });
    if (existingOrg) {
      const err = new Error('An organization with this admin email already exists.');
      (err as any).code = 'ORG_ALREADY_EXISTS';
      (err as any).status = 409;
      throw err;
    }

    const orgId = crypto.randomUUID();
    const adminUserId = crypto.randomUUID();
    const tempPassword = dto.adminPassword || crypto.randomBytes(6).toString('hex') + 'A1!';

    // Salt and hash org admin password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);

    // Create the organization record
    const org = await OrganizationModel.create({
      orgId,
      name: dto.name.trim(),
      adminEmail: dto.adminEmail.toLowerCase(),
      adminUserId,
      status: ORG_STATUS.ACTIVE,
      maxUsers: dto.maxUsers || DEFAULT_ORG_MAX_USERS,
      allocatedStorageBytes: dto.allocatedStorageBytes || DEFAULT_ORG_STORAGE_BYTES,
      usedStorageBytes: 0,
      monthlyForensicLimit: dto.monthlyForensicLimit || DEFAULT_ORG_MONTHLY_FORENSIC_LIMIT,
      currentMonthForensicRuns: 0,
      usageMonth: this.getCurrentMonthKey()
    });

    // Create the Org Admin user account
    await UserModel.create({
      userId: adminUserId,
      email: dto.adminEmail.toLowerCase(),
      passwordHash,
      name: dto.adminName || `${dto.name} Admin`,
      role: USER_ROLES.ORG_ADMIN,
      orgId,
      firmId: orgId,
      isIndependent: false,
      barId: 'ORG_ADMIN',
      barIdStatus: BAR_ID_STATUS.VERIFIED,
      allocatedStorageBytes: 0,
      usedStorageBytes: 0,
      monthlyForensicLimit: 0,
      isActive: true
    });

    // Audit organization creation (FR-7.1, FR-10)
    await AuditService.logAction({
      userId: superAdminId,
      userEmail: superAdminEmail,
      action: 'ORG_CREATE',
      targetType: 'ORGANIZATION',
      targetId: orgId,
      details: {
        orgName: org.name,
        adminEmail: org.adminEmail,
        maxUsers: org.maxUsers,
        allocatedStorageBytes: org.allocatedStorageBytes
      }
    });

    logger.info(`[OrganizationService] Organization created: ${org.name} (${orgId}). Org Admin credentials dispatched.`);

    return {
      organization: this.formatOrgResponse(org, 1),
      adminCredentials: {
        email: org.adminEmail,
        tempPassword
      }
    };
  }

  /**
   * Super Admin lists all organizations with usage telemetry (FR-9.1, FR-9.2)
   */
  static async listOrganizations() {
    const orgs = await OrganizationModel.find().sort({ createdAt: -1 });
    const results: OrganizationResponse[] = [];

    for (const org of orgs) {
      // Auto-reset month if needed
      await this.checkAndResetOrgMonthlyUsage(org);
      const userCount = await UserModel.countDocuments({ orgId: org.orgId, isActive: true });
      results.push(this.formatOrgResponse(org, userCount));
    }

    return results;
  }

  /**
   * Super Admin gets detailed organization by ID (FR-9.1, FR-9.2)
   */
  static async getOrganizationById(orgId: string): Promise<OrganizationResponse> {
    const org = await OrganizationModel.findOne({ orgId });
    if (!org) {
      const err = new Error('Organization not found.');
      (err as any).code = 'ORG_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    await this.checkAndResetOrgMonthlyUsage(org);
    const userCount = await UserModel.countDocuments({ orgId, isActive: true });
    return this.formatOrgResponse(org, userCount);
  }

  /**
   * Super Admin updates organization quotas or status (FR-9.1, FR-9.3, FR-9.7, FR-10)
   */
  static async updateOrganization(
    orgId: string,
    dto: UpdateOrganizationDto,
    superAdminId: string,
    superAdminEmail?: string
  ): Promise<OrganizationResponse> {
    const org = await OrganizationModel.findOne({ orgId });
    if (!org) {
      const err = new Error('Organization not found.');
      (err as any).code = 'ORG_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    if (dto.name) org.name = dto.name.trim();
    if (dto.maxUsers !== undefined) {
      org.maxUsers = dto.maxUsers;
      await AuditService.logAction({
        userId: superAdminId,
        userEmail: superAdminEmail,
        action: 'ORG_USER_LIMIT_CHANGE',
        targetType: 'ORGANIZATION',
        targetId: orgId,
        details: { newMaxUsers: dto.maxUsers }
      });
    }
    if (dto.allocatedStorageBytes !== undefined) {
      org.allocatedStorageBytes = dto.allocatedStorageBytes;
      await AuditService.logAction({
        userId: superAdminId,
        userEmail: superAdminEmail,
        action: 'STORAGE_ALLOCATION_CHANGE',
        targetType: 'ORGANIZATION',
        targetId: orgId,
        details: { newAllocatedBytes: dto.allocatedStorageBytes }
      });
    }
    if (dto.monthlyForensicLimit !== undefined) {
      org.monthlyForensicLimit = dto.monthlyForensicLimit;
      await AuditService.logAction({
        userId: superAdminId,
        userEmail: superAdminEmail,
        action: 'FORENSIC_LIMIT_CHANGE',
        targetType: 'ORGANIZATION',
        targetId: orgId,
        details: { newLimit: dto.monthlyForensicLimit }
      });
    }
    if (dto.status) {
      org.status = dto.status;
      await AuditService.logAction({
        userId: superAdminId,
        userEmail: superAdminEmail,
        action: dto.status === ORG_STATUS.SUSPENDED ? 'ORG_SUSPEND' : 'ORG_UPDATE',
        targetType: 'ORGANIZATION',
        targetId: orgId,
        details: { status: dto.status }
      });
    }

    await org.save();
    const userCount = await UserModel.countDocuments({ orgId, isActive: true });
    return this.formatOrgResponse(org, userCount);
  }

  /**
   * Super Admin views storage overview across orgs and independent users (FR-9.2, FR-9.5)
   */
  static async getStorageOverview() {
    const orgs = await OrganizationModel.find().lean();
    const independentUsers = await UserModel.find({ isIndependent: true, isActive: true })
      .select('userId name email allocatedStorageBytes usedStorageBytes monthlyForensicLimit currentMonthForensicRuns')
      .lean();

    const totalAllocatedStorage =
      orgs.reduce((sum, o) => sum + (o.allocatedStorageBytes || 0), 0) +
      independentUsers.reduce((sum, u) => sum + (u.allocatedStorageBytes || 0), 0);

    const totalUsedStorage =
      orgs.reduce((sum, o) => sum + (o.usedStorageBytes || 0), 0) +
      independentUsers.reduce((sum, u) => sum + (u.usedStorageBytes || 0), 0);

    return {
      totalAllocatedStorageBytes: totalAllocatedStorage,
      totalUsedStorageBytes: totalUsedStorage,
      remainingStorageBytes: Math.max(0, totalAllocatedStorage - totalUsedStorage),
      organizationsCount: orgs.length,
      independentUsersCount: independentUsers.length,
      organizations: orgs.map((o) => ({
        orgId: o.orgId,
        name: o.name,
        allocatedStorageBytes: o.allocatedStorageBytes,
        usedStorageBytes: o.usedStorageBytes,
        remainingStorageBytes: Math.max(0, o.allocatedStorageBytes - o.usedStorageBytes)
      })),
      independentUsers: independentUsers.map((u) => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        allocatedStorageBytes: u.allocatedStorageBytes,
        usedStorageBytes: u.usedStorageBytes,
        remainingStorageBytes: Math.max(0, u.allocatedStorageBytes - u.usedStorageBytes)
      }))
    };
  }

  /**
   * Super Admin updates independent lawyer quotas (FR-9.5, FR-9.7)
   */
  static async updateIndependentUserQuotas(
    userId: string,
    storageBytes?: number,
    forensicLimit?: number,
    superAdminId?: string,
    superAdminEmail?: string
  ) {
    const user = await UserModel.findOne({ userId, isIndependent: true });
    if (!user) {
      const err = new Error('Independent lawyer not found.');
      (err as any).code = 'USER_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    if (storageBytes !== undefined) {
      user.allocatedStorageBytes = storageBytes;
      if (superAdminId) {
        await AuditService.logAction({
          userId: superAdminId,
          userEmail: superAdminEmail,
          action: 'STORAGE_ALLOCATION_CHANGE',
          targetType: 'USER',
          targetId: userId,
          details: { newStorageBytes: storageBytes }
        });
      }
    }

    if (forensicLimit !== undefined) {
      user.monthlyForensicLimit = forensicLimit;
      if (superAdminId) {
        await AuditService.logAction({
          userId: superAdminId,
          userEmail: superAdminEmail,
          action: 'FORENSIC_LIMIT_CHANGE',
          targetType: 'USER',
          targetId: userId,
          details: { newForensicLimit: forensicLimit }
        });
      }
    }

    await user.save();
    return {
      userId: user.userId,
      name: user.name,
      allocatedStorageBytes: user.allocatedStorageBytes,
      usedStorageBytes: user.usedStorageBytes,
      monthlyForensicLimit: user.monthlyForensicLimit,
      currentMonthForensicRuns: user.currentMonthForensicRuns
    };
  }

  // ==========================================
  // ORGANIZATION ADMIN MEMBER MANAGEMENT (FR-1.2, FR-1.3, FR-9.4)
  // ==========================================

  /**
   * Org Admin adds a lawyer to the organization (FR-1.2, FR-1.3, FR-9.4)
   * Enforces maxUsers limit configured by Super Admin.
   */
  static async addLawyerToOrg(
    orgId: string,
    lawyerData: { email: string; name: string; barId: string; password?: string },
    orgAdminId: string,
    orgAdminEmail?: string
  ) {
    const org = await OrganizationModel.findOne({ orgId, status: ORG_STATUS.ACTIVE });
    if (!org) {
      const err = new Error('Organization not found or is currently inactive/suspended.');
      (err as any).code = 'ORG_INACTIVE';
      (err as any).status = 403;
      throw err;
    }

    // Check organization user limit (FR-9.4)
    const currentUserCount = await UserModel.countDocuments({ orgId, isActive: true });
    if (currentUserCount >= org.maxUsers) {
      const err = new Error(
        `Cannot add lawyer: Organization user limit of ${org.maxUsers} users has been reached. Please contact Super Admin to increase your limit.`
      );
      (err as any).code = 'USER_LIMIT_REACHED';
      (err as any).status = 403;
      throw err;
    }

    const existingUser = await UserModel.findOne({ email: lawyerData.email.toLowerCase() });
    if (existingUser) {
      const err = new Error('A user with this email address already exists.');
      (err as any).code = 'EMAIL_ALREADY_EXISTS';
      (err as any).status = 409;
      throw err;
    }

    const tempPassword = lawyerData.password || crypto.randomBytes(6).toString('hex') + 'A1!';
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);
    const userId = crypto.randomUUID();

    const lawyer = await UserModel.create({
      userId,
      email: lawyerData.email.toLowerCase(),
      passwordHash,
      name: lawyerData.name.trim(),
      role: USER_ROLES.LAWYER,
      orgId,
      firmId: orgId,
      isIndependent: false,
      barId: lawyerData.barId.trim(),
      barIdStatus: BAR_ID_STATUS.PENDING, // Pending verification (FR-1.5)
      allocatedStorageBytes: 0, // Uses org pooled storage
      usedStorageBytes: 0,
      monthlyForensicLimit: 0,
      isActive: true
    });

    // Audit lawyer registration (FR-7.1)
    await AuditService.logAction({
      userId: orgAdminId,
      userEmail: orgAdminEmail,
      action: 'LAWYER_REGISTER',
      targetType: 'USER',
      targetId: userId,
      details: {
        orgId,
        lawyerEmail: lawyer.email,
        barId: lawyer.barId
      }
    });

    return {
      lawyer: {
        userId: lawyer.userId,
        email: lawyer.email,
        name: lawyer.name,
        barId: lawyer.barId,
        barIdStatus: lawyer.barIdStatus,
        role: lawyer.role,
        createdAt: lawyer.createdAt
      },
      tempPassword
    };
  }

  /**
   * Org Admin lists all lawyers in their organization
   */
  static async listOrgLawyers(orgId: string) {
    return UserModel.find({ orgId, isActive: true })
      .select('userId email name role barId barIdStatus lastActivityAt createdAt')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Org Admin updates lawyer details
   */
  static async updateOrgLawyer(
    orgId: string,
    lawyerId: string,
    updates: { name?: string; barId?: string }
  ) {
    const lawyer = await UserModel.findOne({ userId: lawyerId, orgId, isActive: true });
    if (!lawyer) {
      const err = new Error('Lawyer not found in this organization.');
      (err as any).code = 'LAWYER_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    if (updates.name) lawyer.name = updates.name.trim();
    if (updates.barId && updates.barId !== lawyer.barId) {
      lawyer.barId = updates.barId.trim();
      lawyer.barIdStatus = BAR_ID_STATUS.PENDING; // Needs re-verification if changed
    }

    await lawyer.save();
    return lawyer;
  }

  /**
   * Org Admin removes lawyer from organization (FR-1.2)
   */
  static async removeLawyerFromOrg(
    orgId: string,
    lawyerId: string,
    orgAdminId: string,
    orgAdminEmail?: string
  ) {
    const lawyer = await UserModel.findOne({ userId: lawyerId, orgId });
    if (!lawyer) {
      const err = new Error('Lawyer not found in this organization.');
      (err as any).code = 'LAWYER_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    lawyer.isActive = false;
    await lawyer.save();

    await AuditService.logAction({
      userId: orgAdminId,
      userEmail: orgAdminEmail,
      action: 'CASE_UPDATE',
      targetType: 'USER',
      targetId: lawyerId,
      details: {
        action: 'LAWYER_REMOVED_FROM_ORG',
        orgId
      }
    });

    return { message: `Lawyer '${lawyer.name}' successfully removed from organization.` };
  }

  // ==========================================
  // STORAGE & FORENSIC QUOTA ENFORCEMENT
  // ==========================================

  /**
   * Validate storage limit before file upload (FR-2.7, FR-9.6)
   */
  static async checkStorageAvailable(
    user: { userId: string; orgId?: string; isIndependent: boolean },
    newBytesToUpload: number
  ): Promise<void> {
    if (user.orgId) {
      // Organization pooled storage (FR-9.6)
      const org = await OrganizationModel.findOne({ orgId: user.orgId });
      if (!org) {
        throw new Error('Associated organization was not found.');
      }

      if (org.status !== ORG_STATUS.ACTIVE) {
        const err = new Error('Organization account is suspended or inactive. Uploads are disabled.');
        (err as any).code = 'ORG_SUSPENDED';
        (err as any).status = 403;
        throw err;
      }

      if (org.usedStorageBytes + newBytesToUpload > org.allocatedStorageBytes) {
        const remainingMb = Math.max(
          0,
          Math.floor((org.allocatedStorageBytes - org.usedStorageBytes) / (1024 * 1024))
        );
        const err = new Error(
          `Storage limit reached for organization '${org.name}'. Only ${remainingMb}MB remaining. Please contact Super Admin to increase storage allocation.`
        );
        (err as any).code = 'STORAGE_LIMIT_EXCEEDED';
        (err as any).status = 413;
        throw err;
      }
    } else {
      // Independent lawyer storage (FR-9.6)
      const lawyer = await UserModel.findOne({ userId: user.userId });
      if (!lawyer) {
        throw new Error('User not found.');
      }

      if (lawyer.usedStorageBytes + newBytesToUpload > lawyer.allocatedStorageBytes) {
        const remainingMb = Math.max(
          0,
          Math.floor((lawyer.allocatedStorageBytes - lawyer.usedStorageBytes) / (1024 * 1024))
        );
        const err = new Error(
          `Storage limit reached for your account. Only ${remainingMb}MB remaining. Please contact support to increase your storage allocation.`
        );
        (err as any).code = 'STORAGE_LIMIT_EXCEEDED';
        (err as any).status = 413;
        throw err;
      }
    }
  }

  /**
   * Add bytes to used storage counter (FR-2.7)
   */
  static async incrementUsedStorage(
    user: { userId: string; orgId?: string },
    bytesAdded: number
  ): Promise<void> {
    if (user.orgId) {
      await OrganizationModel.updateOne(
        { orgId: user.orgId },
        { $inc: { usedStorageBytes: bytesAdded } }
      );
    } else {
      await UserModel.updateOne(
        { userId: user.userId },
        { $inc: { usedStorageBytes: bytesAdded } }
      );
    }
  }

  /**
   * Subtract bytes from used storage counter
   */
  static async decrementUsedStorage(
    user: { userId: string; orgId?: string },
    bytesRemoved: number
  ): Promise<void> {
    if (user.orgId) {
      await OrganizationModel.updateOne(
        { orgId: user.orgId },
        { $inc: { usedStorageBytes: -Math.abs(bytesRemoved) } }
      );
    } else {
      await UserModel.updateOne(
        { userId: user.userId },
        { $inc: { usedStorageBytes: -Math.abs(bytesRemoved) } }
      );
    }
  }

  /**
   * Check and increment monthly forensic run limit (FR-4.8, FR-4.11, FR-9.7, FR-9.8, FR-9.9)
   */
  static async checkAndConsumeForensicRun(user: {
    userId: string;
    orgId?: string;
  }): Promise<{ allowed: boolean; remainingRuns: number; message?: string }> {
    const currentMonth = this.getCurrentMonthKey();

    if (user.orgId) {
      const org = await OrganizationModel.findOne({ orgId: user.orgId });
      if (!org) throw new Error('Organization not found.');

      // Check auto-reset for new month (FR-9.8)
      if (org.usageMonth !== currentMonth) {
        org.usageMonth = currentMonth;
        org.currentMonthForensicRuns = 0;
      }

      // Check if monthly limit reached (FR-9.9)
      if (org.currentMonthForensicRuns >= org.monthlyForensicLimit) {
        return {
          allowed: false,
          remainingRuns: 0,
          message: `Monthly forensic analysis limit of ${org.monthlyForensicLimit} runs reached for organization '${org.name}'. Runs will reset on the 1st of next month or when Super Admin increases the limit.`
        };
      }

      org.currentMonthForensicRuns += 1;
      await org.save();

      return {
        allowed: true,
        remainingRuns: Math.max(0, org.monthlyForensicLimit - org.currentMonthForensicRuns)
      };
    } else {
      const lawyer = await UserModel.findOne({ userId: user.userId });
      if (!lawyer) throw new Error('User not found.');

      if (lawyer.usageMonth !== currentMonth) {
        lawyer.usageMonth = currentMonth;
        lawyer.currentMonthForensicRuns = 0;
      }

      if (lawyer.currentMonthForensicRuns >= lawyer.monthlyForensicLimit) {
        return {
          allowed: false,
          remainingRuns: 0,
          message: `Monthly forensic analysis limit of ${lawyer.monthlyForensicLimit} runs reached for your account. Runs will reset on the 1st of next month or when Super Admin increases your limit.`
        };
      }

      lawyer.currentMonthForensicRuns += 1;
      await lawyer.save();

      return {
        allowed: true,
        remainingRuns: Math.max(0, lawyer.monthlyForensicLimit - lawyer.currentMonthForensicRuns)
      };
    }
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private static async checkAndResetOrgMonthlyUsage(org: IOrganizationDocument) {
    const currentMonth = this.getCurrentMonthKey();
    if (org.usageMonth !== currentMonth) {
      org.usageMonth = currentMonth;
      org.currentMonthForensicRuns = 0;
      await org.save();
    }
  }

  private static formatOrgResponse(org: IOrganizationDocument, userCount = 0): OrganizationResponse {
    return {
      orgId: org.orgId,
      name: org.name,
      adminEmail: org.adminEmail,
      adminUserId: org.adminUserId,
      status: org.status,
      maxUsers: org.maxUsers,
      allocatedStorageBytes: org.allocatedStorageBytes,
      usedStorageBytes: org.usedStorageBytes,
      remainingStorageBytes: Math.max(0, org.allocatedStorageBytes - org.usedStorageBytes),
      monthlyForensicLimit: org.monthlyForensicLimit,
      currentMonthForensicRuns: org.currentMonthForensicRuns,
      userCount,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt
    };
  }
}
