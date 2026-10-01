import type { AuthUserPayload } from './auth.types.ts';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export {};
