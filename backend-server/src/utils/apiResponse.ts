import type { Response } from 'express';
import type { ApiSuccessResponse, ApiErrorResponse } from '../types/api.types.ts';

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>
): Response => {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
    ...(meta ? { meta } : {})
  };
  return res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): Response => {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {})
    }
  };
  return res.status(statusCode).json(response);
};
