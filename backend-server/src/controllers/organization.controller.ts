import type { Request, Response, NextFunction } from 'express';
import { OrganizationService } from '../services/organization.service.ts';
import { sendSuccess, sendError } from '../utils/apiResponse.ts';

export class OrganizationController {
  // ==========================================
  // SUPER ADMIN ENDPOINTS (FR-1.1, FR-9.1 - FR-9.9)
  // ==========================================

  static async createOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const superAdminId = req.user!.userId;
      const superAdminEmail = req.user?.email;

      const result = await OrganizationService.createOrganization(req.body, superAdminId, superAdminEmail);
      sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  }

  static async listOrganizations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgs = await OrganizationService.listOrganizations();
      sendSuccess(res, orgs, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getOrganizationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params.orgId as string;
      const org = await OrganizationService.getOrganizationById(orgId);
      sendSuccess(res, org, 200);
    } catch (error) {
      next(error);
    }
  }

  static async updateOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params.orgId as string;
      const superAdminId = req.user!.userId;
      const superAdminEmail = req.user?.email;

      const updated = await OrganizationService.updateOrganization(orgId, req.body, superAdminId, superAdminEmail);
      sendSuccess(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getStorageOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const overview = await OrganizationService.getStorageOverview();
      sendSuccess(res, overview, 200);
    } catch (error) {
      next(error);
    }
  }

  static async updateIndependentUserQuotas(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params.userId as string;
      const { allocatedStorageBytes, monthlyForensicLimit } = req.body;
      const superAdminId = req.user!.userId;
      const superAdminEmail = req.user?.email;

      const result = await OrganizationService.updateIndependentUserQuotas(
        userId,
        allocatedStorageBytes,
        monthlyForensicLimit,
        superAdminId,
        superAdminEmail
      );
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // ORG ADMIN ENDPOINTS (FR-1.2, FR-1.3, FR-9.4)
  // ==========================================

  static async getMyOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.user?.orgId || req.user?.firmId;
      if (!orgId) {
        sendError(res, 400, 'NO_ORG_ASSOCIATION', 'User is not associated with any organization.');
        return;
      }
      const org = await OrganizationService.getOrganizationById(orgId);
      sendSuccess(res, org, 200);
    } catch (error) {
      next(error);
    }
  }

  static async addLawyer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.user?.orgId || req.user?.firmId;
      if (!orgId) {
        sendError(res, 400, 'NO_ORG_ASSOCIATION', 'User is not associated with any organization.');
        return;
      }

      const orgAdminId = req.user!.userId;
      const orgAdminEmail = req.user?.email;

      const result = await OrganizationService.addLawyerToOrg(orgId, req.body, orgAdminId, orgAdminEmail);
      sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  }

  static async listLawyers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.user?.orgId || req.user?.firmId;
      if (!orgId) {
        sendError(res, 400, 'NO_ORG_ASSOCIATION', 'User is not associated with any organization.');
        return;
      }

      const lawyers = await OrganizationService.listOrgLawyers(orgId);
      sendSuccess(res, lawyers, 200);
    } catch (error) {
      next(error);
    }
  }

  static async updateLawyer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.user?.orgId || req.user?.firmId;
      const lawyerId = req.params.userId as string;

      if (!orgId) {
        sendError(res, 400, 'NO_ORG_ASSOCIATION', 'User is not associated with any organization.');
        return;
      }

      const updated = await OrganizationService.updateOrgLawyer(orgId, lawyerId, req.body);
      sendSuccess(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }

  static async removeLawyer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.user?.orgId || req.user?.firmId;
      const lawyerId = req.params.userId as string;
      const orgAdminId = req.user!.userId;
      const orgAdminEmail = req.user?.email;

      if (!orgId) {
        sendError(res, 400, 'NO_ORG_ASSOCIATION', 'User is not associated with any organization.');
        return;
      }

      const result = await OrganizationService.removeLawyerFromOrg(orgId, lawyerId, orgAdminId, orgAdminEmail);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
