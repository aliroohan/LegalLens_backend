import type { Request, Response, NextFunction } from 'express';
import { ZodError, type AnyZodObject } from 'zod';
import { sendError } from '../utils/apiResponse.ts';

export const validateBody = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message
        }));
        sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed.', details);
        return;
      }
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request data.');
    }
  };
};

export const validateQuery = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.query = await schema.parseAsync(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message
        }));
        sendError(res, 400, 'QUERY_VALIDATION_ERROR', 'Invalid query parameters.', details);
        return;
      }
      sendError(res, 400, 'QUERY_VALIDATION_ERROR', 'Invalid query parameters.');
    }
  };
};
