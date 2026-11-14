import crypto from 'node:crypto';
import axios from 'axios';
import { FileModel } from '../models/file.model.ts';
import { ReverseSearchModel, type IReverseSearchDocument } from '../models/reverseSearch.model.ts';
import { AuditService } from './audit.service.ts';
import { ENV } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

export class ReverseSearchService {
  /**
   * Perform reverse image search on an uploaded evidence image (FR-4.12, FR-4.13)
   * Uses RapidAPI Reverse Image Search endpoint.
   * System clearly informs user if no matches found rather than failing the forensic pipeline.
   */
  static async search(
    fileId: string,
    userId: string,
    userEmail?: string,
    imageUrl?: string
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

    let results: Array<{
      title: string;
      sourceUrl: string;
      matchImageUrl?: string;
      similarityScore?: number;
      snippet?: string;
    }> = [];
    let status: 'completed' | 'no_matches_found' | 'failed' = 'no_matches_found';
    let message = 'No matching or visually similar external images were discovered across indexed sources.';

    const targetUrl = imageUrl?.trim();

    try {
      if (!targetUrl) {
        // RapidAPI requires a publicly accessible image URL
        status = 'no_matches_found';
        message = 'Reverse search requires a public image URL. Please upload the image to an image host (e.g. ImgBB, Cloudinary) or provide an imageUrl parameter.';
      } else if (!ENV.RAPIDAPI_KEY) {
        status = 'no_matches_found';
        message = 'RapidAPI key is not configured in backend environment.';
      } else {
        logger.info(`[ReverseSearchService] Querying RapidAPI reverse search for file ${fileId} with URL: ${targetUrl}`);

        const response = await axios.get('https://reverse-image-search1.p.rapidapi.com/reverse-image-search', {
          params: {
            url: targetUrl,
            limit: 10,
            safe_search: 'blur'
          },
          headers: {
            'x-rapidapi-key': ENV.RAPIDAPI_KEY,
            'x-rapidapi-host': ENV.RAPIDAPI_HOST
          },
          timeout: 25000
        });

        const data = response.data;
        if (data && Array.isArray(data.data) && data.data.length > 0) {
          results = data.data.map((item: any) => ({
            title: item.title || 'Matching External Webpage',
            sourceUrl: item.link || '',
            matchImageUrl: item.image || undefined,
            similarityScore: undefined,
            snippet: item.domain ? `Domain: ${item.domain}${item.date ? ` | Date: ${item.date}` : ''}` : undefined
          }));
          status = 'completed';
          message = `Discovered ${results.length} matching pages and visually related images.`;
        } else {
          status = 'no_matches_found';
          message = 'No matching or visually similar external images were discovered for the provided image URL.';
        }
      }
    } catch (searchErr: any) {
      const errMsg = searchErr?.response?.data?.error?.message || searchErr?.response?.data?.message || searchErr?.message;
      logger.warn(`[ReverseSearchService] RapidAPI search warning for file ${fileId}: ${errMsg}`);
      status = 'no_matches_found';
      message = `External search provider returned: ${errMsg || 'temporarily unreachable.'}`;
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
