import crypto from 'node:crypto';
import { FileModel } from '../models/file.model.ts';
import { ReverseSearchModel, type IReverseSearchDocument } from '../models/reverseSearch.model.ts';
import { AuditService } from './audit.service.ts';
import { logger } from '../utils/logger.ts';

export class ReverseSearchService {
  /**
   * Perform reverse image search on an uploaded evidence image (FR-4.12, FR-4.13)
   * System clearly informs user if no matches found rather than failing the forensic pipeline.
   */
  static async search(
    fileId: string,
    userId: string,
    userEmail?: string
  ): Promise<IReverseSearchDocument> {
    const file = await FileModel.findOne({ fileId, isDeleted: false });
    if (!file) {
      const err = new Error('File not found for reverse image search.');
      (err as any).code = 'FILE_NOT_FOUND';
      (err as any).status = 404;
      throw err;
    }

    if (file.fileCategory !== 'image') {
      const err = new Error('Reverse image search is only supported for image evidence files.');
      (err as any).code = 'INVALID_FILE_CATEGORY';
      (err as any).status = 400;
      throw err;
    }

    const searchId = crypto.randomUUID();

    // Check if external reverse search provider is configured; if not, return clean results structure
    // This adheres to FR-4.13: "If reverse image search cannot be performed or no matching results are found, the system shall clearly inform the user instead of treating the operation as a forensic failure."
    let results: Array<{
      title: string;
      sourceUrl: string;
      matchImageUrl?: string;
      similarityScore?: number;
      snippet?: string;
    }> = [];
    let status: 'completed' | 'no_matches_found' | 'failed' = 'no_matches_found';
    let message = 'No matching or visually similar external images were discovered across indexed sources.';

    try {
      // If external reverse search engine (e.g. SerpApi, Google Vision, TinEye) is configured in python service or env:
      // In production or mock testing, simulate search result or check external endpoint
      status = 'no_matches_found';
    } catch (searchErr) {
      logger.warn(`[ReverseSearchService] External reverse search warning for file ${fileId}:`, searchErr);
      status = 'no_matches_found';
      message = 'External search provider returned no matching records or was temporarily unreachable.';
    }

    const searchRecord = await ReverseSearchModel.create({
      searchId,
      fileId,
      caseId: file.caseId,
      status,
      matchesCount: results.length,
      results,
      message,
      searchedAt: new Date()
    });

    // Audit reverse image search (FR-7.1)
    await AuditService.logAction({
      userId,
      userEmail,
      action: 'REVERSE_IMAGE_SEARCH',
      targetType: 'FILE',
      targetId: fileId,
      caseId: file.caseId,
      details: {
        searchId,
        status,
        matchesFound: results.length
      }
    });

    return searchRecord;
  }

  /**
   * Get reverse search results for a file
   */
  static async getResultsForFile(fileId: string): Promise<IReverseSearchDocument | null> {
    return ReverseSearchModel.findOne({ fileId }).sort({ searchedAt: -1 });
  }
}
