import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql, sum } from 'drizzle-orm';
import {
  EventStatus,
  NotificationType,
  PhotoStatus,
  SubscriptionStatus,
  events,
  photos,
  storageObjects,
  studios,
  subscriptions,
} from '../db/schema';
import sharp from 'sharp';
import { DrizzleService } from '../db/drizzle.service';
import { StorageService } from '../storage/storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { ProcessingService } from '../processing/processing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isUniqueViolation } from '../common/utils/db-errors';
import {
  sanitizeFilename,
  sha256,
} from '../common/utils/crypto.util';
import {
  originalKey,
  previewKey,
  thumbnailKey,
} from '../common/utils/storage-keys';
import { paginate } from '../common/utils/pagination.util';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import type { PhotoListQueryDto } from './dto/photos.dto';

const IMAGE_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
};

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
};

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/** Drizzle wraps driver errors, so walk the cause chain for SQLSTATE 23505. */
function isUniqueViolationDeep(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (isUniqueViolation(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type UploadResult =
  | {
      filename: string;
      status: 'uploaded';
      photo: Record<string, unknown>;
    }
  | {
      filename: string;
      status: 'duplicate';
      message: string;
      existingPhotoId: string;
    }
  | {
      filename: string;
      status: 'failed';
      message: string;
    };

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly storageUsage: StorageUsageService,
    private readonly processing: ProcessingService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async planContext(studioId: string) {
    const subscription = await this.database.db.query.subscriptions.findFirst({
      where: eq(subscriptions.studioId, studioId),
      with: { plan: true },
    });
    if (!subscription) {
      throw new ForbiddenException({
        code: 'NO_SUBSCRIPTION',
        message: 'This studio does not have a subscription plan.',
      });
    }
    if (
      subscription.status === SubscriptionStatus.CANCELED ||
      subscription.status === SubscriptionStatus.EXPIRED
    ) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_INACTIVE',
        message: 'Your subscription is inactive. Reactivate it to upload photographs.',
      });
    }
    return subscription;
  }

  async upload(
    studio: StudioContext,
    eventId: string,
    files: Express.Multer.File[],
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<{ results: UploadResult[]; uploaded: number; duplicates: number; failed: number }> {
    if (!files?.length) throw new BadRequestException('Choose at least one photograph');
    if (files.length > 20) {
      throw new BadRequestException('Upload at most 20 photographs per request');
    }

    const [event] = await this.database.db
      .select({
        id: events.id,
        name: events.name,
        status: events.status,
        slug: events.slug,
        photoCount: events.photoCount,
      })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.studioId, studio.id)))
      .limit(1);
    if (!event) throw new NotFoundException('Event not found');
    if (event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('This event is archived and cannot accept photographs');
    }

    const subscription = await this.planContext(studio.id);
    const [photoCountRows, studioRows] = await Promise.all([
      this.database.db
        .select({ value: count() })
        .from(photos)
        .where(eq(photos.eventId, eventId)),
      this.database.db
        .select({ storageUsedBytes: studios.storageUsedBytes })
        .from(studios)
        .where(eq(studios.id, studio.id))
        .limit(1),
    ]);
    const photoCount = Number(photoCountRows[0]?.value ?? 0);
    const studioRow = studioRows[0];

    let projectedPhotos = photoCount;
    let projectedStorage = studioRow?.storageUsedBytes ?? 0;
    const storageLimit = subscription.plan.maxStorageGb * 1024 * 1024 * 1024;
    const totalBytes = files.reduce((sum, file) => sum + (file.size ?? file.buffer?.length ?? 0), 0);

    this.realtime.emitToStudio(studio.id, 'upload.started', {
      eventId,
      fileCount: files.length,
      totalBytes,
    });

    const results: UploadResult[] = [];
    let uploaded = 0;
    let duplicates = 0;
    let failed = 0;

    for (const file of files) {
      const displayName = sanitizeFilename(file.originalname || 'photograph.jpg');
      try {
        if (!file.buffer?.length) {
          failed += 1;
          results.push({ filename: displayName, status: 'failed', message: 'Empty file' });
          continue;
        }

        const metadata = await sharp(file.buffer).metadata().catch(() => null);
        const mimeType = metadata?.format ? IMAGE_MIME[metadata.format] : undefined;
        if (!metadata || !mimeType) {
          failed += 1;
          results.push({
            filename: displayName,
            status: 'failed',
            message: 'Only JPEG, PNG, WebP, AVIF, or TIFF photographs are supported',
          });
          continue;
        }
        if ((metadata.width ?? 0) * (metadata.height ?? 0) > 100_000_000) {
          failed += 1;
          results.push({
            filename: displayName,
            status: 'failed',
            message: 'Image dimensions are too large',
          });
          continue;
        }

        if (projectedPhotos >= subscription.plan.maxPhotosPerEvent) {
          failed += 1;
          results.push({
            filename: displayName,
            status: 'failed',
            message: `Your plan allows ${subscription.plan.maxPhotosPerEvent} photographs per event`,
          });
          continue;
        }
        if (projectedStorage + file.buffer.length > storageLimit) {
          failed += 1;
          results.push({
            filename: displayName,
            status: 'failed',
            message: `This upload would exceed ${subscription.plan.maxStorageGb} GB of plan storage`,
          });
          continue;
        }

        const checksum = sha256(file.buffer);
        const [duplicate] = await this.database.db
          .select({ id: photos.id })
          .from(photos)
          .where(and(eq(photos.eventId, eventId), eq(photos.checksum, checksum)))
          .limit(1);
        if (duplicate) {
          duplicates += 1;
          results.push({
            filename: displayName,
            status: 'duplicate',
            message: 'This photograph is already in the event gallery',
            existingPhotoId: duplicate.id,
          });
          continue;
        }

        const photoId = crypto.randomUUID();
        const key = originalKey(studio.id, eventId, photoId, `${photoId}-${displayName}`);
        await this.storage.upload(key, file.buffer, mimeType, {
          'original-filename': encodeURIComponent(displayName),
          'event-id': eventId,
        });

        let photo: typeof photos.$inferSelect;
        try {
          photo = await this.database.db.transaction(async (tx) => {
            const [created] = await tx
              .insert(photos)
              .values({
                id: photoId,
                eventId,
                uploadedById: user.id,
                storageKey: key,
                originalFilename: displayName,
                mimeType,
                sizeBytes: file.buffer.length,
                width: metadata.width ?? null,
                height: metadata.height ?? null,
                checksum,
                status: PhotoStatus.QUEUED,
              })
              .returning();
            await tx
              .update(events)
              .set({ photoCount: sql`${events.photoCount} + 1` })
              .where(eq(events.id, eventId));
            return created;
          });
        } catch (error) {
          await this.storage.remove(key).catch(() => undefined);
          if (isUniqueViolationDeep(error)) {
            duplicates += 1;
            const [existing] = await this.database.db
              .select({ id: photos.id })
              .from(photos)
              .where(and(eq(photos.eventId, eventId), eq(photos.checksum, checksum)))
              .limit(1);
            results.push({
              filename: displayName,
              status: 'duplicate',
              message: 'This photograph is already in the event gallery',
              existingPhotoId: existing?.id ?? '',
            });
            continue;
          }
          throw error;
        }

        await this.storageUsage.record({
          studioId: studio.id,
          eventId,
          photoId,
          key,
          kind: 'ORIGINAL',
          bytes: file.buffer.length,
          contentType: mimeType,
        });
        projectedPhotos += 1;
        projectedStorage += file.buffer.length;
        uploaded += 1;

        await this.processing.enqueuePhoto({ photoId, eventId, studioId: studio.id }).catch(async (error) => {
          this.logger.error(`Could not enqueue photo ${photoId}: ${(error as Error).message}`);
          await this.database.db
            .update(photos)
            .set({ status: PhotoStatus.FAILED, processingError: 'Queue unavailable' })
            .where(eq(photos.id, photoId));
        });

        results.push({
          filename: displayName,
          status: 'uploaded',
          photo: {
            id: photo.id,
            eventId,
            originalFilename: photo.originalFilename,
            status: photo.status,
            width: photo.width,
            height: photo.height,
            sizeBytes: photo.sizeBytes,
            createdAt: photo.createdAt,
          },
        });
        this.realtime.emitToStudio(studio.id, 'upload.completed', {
          photoId,
          eventId,
          filename: displayName,
          status: PhotoStatus.QUEUED,
        });
      } catch (error) {
        failed += 1;
        this.logger.error(`Upload failed for ${displayName}: ${(error as Error).message}`);
        results.push({
          filename: displayName,
          status: 'failed',
          message: 'The photograph could not be uploaded. Please retry.',
        });
      }
    }

    if (uploaded > 0) {
      this.realtime.emitToStudio(studio.id, 'storage.updated', { studioId: studio.id });
      this.realtime.emitToStudio(studio.id, 'gallery.updated', { eventId });
      await this.notifications
        .create({
          studioId: studio.id,
          userId: user.id,
          eventId,
          type: NotificationType.UPLOAD_COMPLETE,
          title: `${uploaded} photograph${uploaded === 1 ? '' : 's'} uploaded`,
          body: `AI face indexing is running for ${event.name}. We'll let you know when the gallery is ready.`,
          data: { uploaded, duplicates, failed },
        })
        .catch(() => undefined);
    }

    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'PHOTOS_UPLOADED',
      entity: 'event',
      entityId: eventId,
      metadata: { uploaded, duplicates, failed, files: files.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { results, uploaded, duplicates, failed };
  }

  async list(studioId: string, query: PhotoListQueryDto) {
    const conditions = [eq(events.studioId, studioId)];
    if (query.eventId) conditions.push(eq(photos.eventId, query.eventId));
    if (query.status) conditions.push(eq(photos.status, query.status));
    if (query.search) {
      conditions.push(ilike(photos.originalFilename, `%${query.search}%`));
    }
    const where = and(...conditions);
    const orderBy =
      query.sort === 'oldest'
        ? asc(photos.createdAt)
        : query.sort === 'filename'
          ? asc(photos.originalFilename)
          : desc(photos.createdAt);

    const [rows, totalRows] = await Promise.all([
      this.database.db
        .select({
          id: photos.id,
          eventId: photos.eventId,
          event: {
            id: events.id,
            name: events.name,
            slug: events.slug,
          },
          originalFilename: photos.originalFilename,
          mimeType: photos.mimeType,
          sizeBytes: photos.sizeBytes,
          width: photos.width,
          height: photos.height,
          status: photos.status,
          processingError: photos.processingError,
          faceCount: photos.faceCount,
          takenAt: photos.takenAt,
          createdAt: photos.createdAt,
          thumbnailKey: photos.thumbnailKey,
          previewKey: photos.previewKey,
        })
        .from(photos)
        .innerJoin(events, eq(photos.eventId, events.id))
        .where(where)
        .orderBy(orderBy)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.database.db
        .select({ value: count() })
        .from(photos)
        .innerJoin(events, eq(photos.eventId, events.id))
        .where(where),
    ]);

    const data = await Promise.all(
      rows.map(async (photo) => ({
        id: photo.id,
        eventId: photo.eventId,
        event: photo.event,
        originalFilename: photo.originalFilename,
        mimeType: photo.mimeType,
        sizeBytes: photo.sizeBytes,
        width: photo.width,
        height: photo.height,
        status: photo.status,
        processingError: photo.processingError,
        faceCount: photo.faceCount,
        takenAt: photo.takenAt,
        createdAt: photo.createdAt,
        thumbnailUrl: await this.signed(photo.thumbnailKey),
        previewUrl: await this.signed(photo.previewKey),
      })),
    );
    return paginate(data, Number(totalRows[0]?.value ?? 0), query.page, query.limit);
  }

  async stats(studioId: string, eventId?: string) {
    const conditions = [eq(events.studioId, studioId)];
    const storageConditions = [
      eq(storageObjects.studioId, studioId),
      isNull(storageObjects.deletedAt),
    ];
    if (eventId) {
      conditions.push(eq(photos.eventId, eventId));
      storageConditions.push(eq(storageObjects.eventId, eventId));
    }
    const where = and(...conditions);

    const [groups, totalRows, storageRows] = await Promise.all([
      this.database.db
        .select({ status: photos.status, value: count() })
        .from(photos)
        .innerJoin(events, eq(photos.eventId, events.id))
        .where(where)
        .groupBy(photos.status),
      this.database.db
        .select({ value: count() })
        .from(photos)
        .innerJoin(events, eq(photos.eventId, events.id))
        .where(where),
      this.database.db
        .select({ value: sum(storageObjects.bytes) })
        .from(storageObjects)
        .where(and(...storageConditions)),
    ]);
    const counts = groups.reduce<Record<string, number>>((acc, group) => {
      acc[group.status] = Number(group.value);
      return acc;
    }, {});
    return {
      total: Number(totalRows[0]?.value ?? 0),
      byStatus: {
        queued: counts.QUEUED ?? 0,
        processing: counts.PROCESSING ?? 0,
        ready: counts.READY ?? 0,
        failed: counts.FAILED ?? 0,
      },
      storageBytes: Number(storageRows[0]?.value ?? 0),
    };
  }

  async get(studioId: string, photoId: string) {
    const photo = await this.database.db.query.photos.findFirst({
      where: and(
        eq(photos.id, photoId),
        inArray(
          photos.eventId,
          this.database.db
            .select({ id: events.id })
            .from(events)
            .where(eq(events.studioId, studioId)),
        ),
      ),
      with: {
        event: { columns: { id: true, name: true, slug: true } },
        metadata: true,
      },
    });
    if (!photo) throw new NotFoundException('Photograph not found');
    return {
      id: photo.id,
      eventId: photo.eventId,
      event: photo.event,
      originalFilename: photo.originalFilename,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      width: photo.width,
      height: photo.height,
      checksum: photo.checksum,
      status: photo.status,
      processingError: photo.processingError,
      faceCount: photo.faceCount,
      takenAt: photo.takenAt,
      createdAt: photo.createdAt,
      metadata: photo.metadata,
      thumbnailUrl: await this.signed(photo.thumbnailKey),
      previewUrl: await this.signed(photo.previewKey),
      originalUrl: await this.signed(photo.storageKey, 900, photo.originalFilename),
    };
  }

  async remove(studioId: string, photoId: string, user: AuthUser, meta: RequestMeta) {
    const [photo] = await this.database.db
      .select({
        id: photos.id,
        eventId: photos.eventId,
        storageKey: photos.storageKey,
        thumbnailKey: photos.thumbnailKey,
        previewKey: photos.previewKey,
        faceCount: photos.faceCount,
        originalFilename: photos.originalFilename,
      })
      .from(photos)
      .innerJoin(events, eq(photos.eventId, events.id))
      .where(and(eq(photos.id, photoId), eq(events.studioId, studioId)))
      .limit(1);
    if (!photo) throw new NotFoundException('Photograph not found');

    for (const key of [photo.storageKey, photo.thumbnailKey, photo.previewKey]) {
      if (!key) continue;
      await this.storage.remove(key).catch(() => undefined);
    }
    await this.storageUsage.removeForPhoto(photoId).catch(() => undefined);

    await this.database.db.transaction(async (tx) => {
      await tx.delete(photos).where(eq(photos.id, photoId));
      const [event] = await tx
        .select({ photoCount: events.photoCount, faceCount: events.faceCount })
        .from(events)
        .where(eq(events.id, photo.eventId))
        .limit(1);
      await tx
        .update(events)
        .set({
          photoCount: Math.max(0, (event?.photoCount ?? 1) - 1),
          faceCount: Math.max(0, (event?.faceCount ?? photo.faceCount) - photo.faceCount),
        })
        .where(eq(events.id, photo.eventId));
    });

    await this.audit.record({
      studioId,
      actorId: user.id,
      action: 'PHOTO_DELETED',
      entity: 'photo',
      entityId: photoId,
      metadata: { eventId: photo.eventId, filename: photo.originalFilename },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.realtime.emitToStudio(studioId, 'photo.deleted', {
      photoId,
      eventId: photo.eventId,
    });
    this.realtime.emitToStudio(studioId, 'gallery.updated', { eventId: photo.eventId });
    this.realtime.emitToStudio(studioId, 'storage.updated', { studioId });
    return { message: 'Photograph deleted' };
  }

  async reprocess(studioId: string, photoId: string, user: AuthUser, meta: RequestMeta) {
    const [photo] = await this.database.db
      .select({ id: photos.id, eventId: photos.eventId })
      .from(photos)
      .innerJoin(events, eq(photos.eventId, events.id))
      .where(and(eq(photos.id, photoId), eq(events.studioId, studioId)))
      .limit(1);
    if (!photo) throw new NotFoundException('Photograph not found');
    await this.database.db
      .update(photos)
      .set({ status: PhotoStatus.QUEUED, processingError: null })
      .where(eq(photos.id, photoId));
    await this.processing.enqueuePhoto({
      photoId,
      eventId: photo.eventId,
      studioId,
    });
    await this.audit.record({
      studioId,
      actorId: user.id,
      action: 'PHOTO_REPROCESS_QUEUED',
      entity: 'photo',
      entityId: photoId,
      metadata: { eventId: photo.eventId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.realtime.emitToStudio(studioId, 'photo.processing', {
      photoId,
      eventId: photo.eventId,
    });
    return { message: 'Photograph queued for reprocessing' };
  }

  async downloadUrl(studioId: string, photoId: string) {
    const [photo] = await this.database.db
      .select({ storageKey: photos.storageKey, originalFilename: photos.originalFilename })
      .from(photos)
      .innerJoin(events, eq(photos.eventId, events.id))
      .where(and(eq(photos.id, photoId), eq(events.studioId, studioId)))
      .limit(1);
    if (!photo) throw new NotFoundException('Photograph not found');
    return {
      url: await this.storage.signedGetUrl(photo.storageKey, {
        ttlSeconds: 300,
        downloadName: photo.originalFilename,
      }),
    };
  }

  private async signed(key: string | null, ttl = 3600, downloadName?: string): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storage.signedGetUrl(key, { ttlSeconds: ttl, downloadName });
    } catch {
      return null;
    }
  }
}
