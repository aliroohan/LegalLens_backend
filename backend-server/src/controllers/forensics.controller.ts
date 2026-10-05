import type { Request, Response, NextFunction } from 'express';
import { ForensicsService } from '../services/forensics.service.ts';
import { ReverseSearchService } from '../services/reverseSearch.service.ts';
import { sendSuccess, sendError } from '../utils/apiResponse.ts';

export class ForensicsController {
  /**
   * Run or re-trigger forensic analysis (FR-4.1 - FR-4.11)
   */
  static async analyzeFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const userId = req.user!.userId;
      const userEmail = req.user?.email;
      const orgId = req.user?.orgId || req.user?.firmId;
      const customWeights = req.body?.customWeights;

      const result = await ForensicsService.analyzeFile(fileId, userId, userEmail, customWeights, orgId);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get latest forensic results for a file (FR-4.10)
   */
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

  /**
   * Get all forensic results for a case
   */
  static async getResultsForCase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params.caseId as string;
      const results = await ForensicsService.getResultsForCase(caseId);
      sendSuccess(res, results, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Trigger reverse image search on an evidence image (FR-4.12, FR-4.13)
   */
  static async reverseImageSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const userId = req.user!.userId;
      const userEmail = req.user?.email;

      const results = await ReverseSearchService.search(fileId, userId, userEmail);
      sendSuccess(res, results, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get reverse image search results for an image (FR-4.13)
   */
  static async getReverseSearchResults(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId as string;
      const result = await ReverseSearchService.getResultsForFile(fileId);

      if (!result) {
        sendSuccess(res, {
          status: 'no_matches_found',
          matchesCount: 0,
          results: [],
          message: 'No reverse search has been executed yet for this evidence file.'
        }, 200);
        return;
      }

      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
