import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.ts';
import { sendError } from '../utils/apiResponse.ts';
import type { AuthUserPayload } from '../types/auth.types.ts';
import { TokenBlacklistModel } from '../models/tokenBlacklist.model.ts';
import { BAR_ID_STATUS, USER_ROLES, type UserRole } from '../config/constants.ts';

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required. Please provide a valid Bearer token.');
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    sendError(res, 401, 'UNAUTHORIZED', 'Bearer token is missing.');
    return;
  }

  // Check if token has been invalidated via logout (FR-1.8)
  const isBlacklisted = await TokenBlacklistModel.findOne({ token });
  if (isBlacklisted) {
    sendError(res, 401, 'SESSION_TERMINATED', 'This session has been logged out. Please log in again.');
    return;
  }

  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as AuthUserPayload;
    req.user = decoded;
    next();
  } catch (error) {
    sendError(res, 401, 'INVALID_TOKEN', 'Session token is invalid or has expired after inactivity.');
  }
};

/**
 * Enforce Role-Based Access Control
 */
export const requireRoles = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
      return;
    }

    if (!roles.includes(req.user.role)) {
      sendError(
        res,
        403,
        'FORBIDDEN',
        `Access denied. Role '${req.user.role}' is not authorized for this resource.`
      );
      return;
    }

    next();
  };
};

/**
 * Verify that a lawyer account has an active and confirmed Bar ID (FR-1.5)
 */
export const requireVerifiedBarId = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    return;
  }

  // Super admins and org admins bypass bar check for administrative functions
  if (req.user.role === USER_ROLES.SUPER_ADMIN || req.user.role === USER_ROLES.ORG_ADMIN) {
    return next();
  }

  if (req.user.role === USER_ROLES.LAWYER && req.user.barIdStatus !== BAR_ID_STATUS.VERIFIED) {
    sendError(
      res,
      403,
      'BAR_ID_NOT_VERIFIED',
      'Account inactive. Your Bar ID is currently pending verification or rejected. You cannot perform case actions until it is verified.'
    );
    return;
  }

  next();
};

/**
 * Enforce Super Admin Case Content Isolation (NFR Data Retention & Privacy)
 * The Super Admin shall have access to usage and storage information only, not case contents.
 */
export const restrictSuperAdminFromCases = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role === USER_ROLES.SUPER_ADMIN) {
    sendError(
      res,
      403,
      'SUPER_ADMIN_CASE_ISOLATION',
      'Privacy Policy Violation: Super Admin accounts are strictly restricted from viewing or altering case contents, files, and forensic evidence.'
    );
    return;
  }

  next();
};
