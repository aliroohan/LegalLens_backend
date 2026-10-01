import type { Request, Response } from 'express';
import { sendError } from '../utils/apiResponse.ts';

export const notFoundHandler = (req: Request, res: Response): void => {
  sendError(
    res,
    404,
    'RESOURCE_NOT_FOUND',
    `Cannot ${req.method} ${req.originalUrl}. Route not found.`
  );
};
