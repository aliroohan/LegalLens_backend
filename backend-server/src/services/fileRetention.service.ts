import {
  CLOUDINARY_PURGE_JOB_INTERVAL_MS,
  DELETED_FILE_CLOUDINARY_RETENTION_DAYS
} from '../config/constants.ts';
import { ENV } from '../config/env.ts';
import { FileModel } from '../models/file.model.ts';
import { AuditService } from './audit.service.ts';
import { destroyCloudinaryAsset, type CloudinaryResourceType } from './cloudinary.service.ts';
import { logger } from '../utils/logger.ts';

function retentionCutoff(): Date {
  const ms = DELETED_FILE_CLOUDINARY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

function cloudinaryConfigured(): boolean {
  return Boolean(
    ENV.CLOUDINARY_CLOUD_NAME && ENV.CLOUDINARY_API_KEY && ENV.CLOUDINARY_API_SECRET
  );
}

export class FileRetentionService {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  static startScheduledPurge(): void {
    if (this.timer) return;

    void this.purgeExpiredCloudinaryAssets();

    this.timer = setInterval(() => {
      void this.purgeExpiredCloudinaryAssets();
    }, CLOUDINARY_PURGE_JOB_INTERVAL_MS);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    logger.info(
      `Cloudinary retention purge scheduled every ${CLOUDINARY_PURGE_JOB_INTERVAL_MS / 3600000}h ` +
        `(${DELETED_FILE_CLOUDINARY_RETENTION_DAYS} days after soft delete).`
    );
  }

  static stopScheduledPurge(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  static async purgeExpiredCloudinaryAssets(): Promise<{ purged: number; failed: number }> {
    if (this.running) {
      return { purged: 0, failed: 0 };
    }

    if (!cloudinaryConfigured()) {
      return { purged: 0, failed: 0 };
    }

    this.running = true;
    let purged = 0;
    let failed = 0;

    try {
      const cutoff = retentionCutoff();
      const batch = await FileModel.find({
        isDeleted: true,
        deletedAt: { $lte: cutoff },
        cloudinaryPublicId: { $exists: true, $nin: [null, ''] },
        cloudinaryPurgedAt: { $exists: false }
      })
        .limit(50)
        .exec();

      for (const file of batch) {
        const publicId = file.cloudinaryPublicId!;
        const resourceType = (file.cloudinaryResourceType || 'raw') as CloudinaryResourceType;

        try {
          const outcome = await destroyCloudinaryAsset({ publicId, resourceType });

          file.cloudinaryPurgedAt = new Date();
          file.storagePath = 'purged';
          file.workingCopyPath = 'purged';
          await file.save();

          await AuditService.logAction({
            userId: 'system',
            userEmail: 'system@legallens',
            action: 'FILE_STORAGE_PURGED' as const,
            targetType: 'FILE',
            targetId: file.fileId,
            caseId: file.caseId,
            details: {
              cloudinaryPublicId: publicId,
              cloudinaryDestroyResult: outcome,
              deletedAt: file.deletedAt?.toISOString(),
              retentionDays: DELETED_FILE_CLOUDINARY_RETENTION_DAYS
            }
          });

          purged += 1;
        } catch (error) {
          failed += 1;
          logger.error(`Failed to purge Cloudinary asset for file ${file.fileId}:`, error);
        }
      }

      if (purged > 0 || failed > 0) {
        logger.info(`Cloudinary retention purge finished: ${purged} purged, ${failed} failed.`);
      }
    } finally {
      this.running = false;
    }

    return { purged, failed };
  }
}
