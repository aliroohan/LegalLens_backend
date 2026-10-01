import type { Request, Response, NextFunction } from 'express';
import { ForensicsService } from '../services/forensics.service.ts';
import { sendSuccess, sendError } from '../utils/apiResponse.ts';

export class ForensicsController {
  static async analyzeFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const userId = req.user!.userId;
      const userEmail = req.user?.email;
      const customWeights = req.body?.customWeights;

      const result = await ForensicsService.analyzeFile(fileId, userId, userEmail, customWeights);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getResultByFileId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const result = await ForensicsService.getResultByFileId(fileId);

      if (!result) {
        sendError(res, 404, 'FORENSIC_RESULT_NOT_FOUND', `No forensic result found for file '${fileId}'.`);
        return;
      }

      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  static async getResultsForCase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const results = await ForensicsService.getResultsForCase(caseId);
      sendSuccess(res, results, 200);
    } catch (error) {
      next(error);
    }
  }
}
