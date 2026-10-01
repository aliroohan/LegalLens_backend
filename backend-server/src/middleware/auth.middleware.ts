import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.ts';
import { sendError } from '../utils/apiResponse.ts';
import type { AuthUserPayload } from '../types/auth.types.ts';

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
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

  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as AuthUserPayload;
    req.user = decoded;
    next();
  } catch (error) {
    sendError(res, 401, 'INVALID_TOKEN', 'Session token is invalid or has expired.');
  }
};
