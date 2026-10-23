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

export const validate = validateBody;

export const validateQuery = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.query);
      // Express 5: req.query is a read-only getter, so assigning to it throws.
      // Define it as an own property on this request instead.
      Object.defineProperty(req, 'query', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true
      });
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