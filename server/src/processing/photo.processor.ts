import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId } from '@paralleldrive/cuid2';
import { eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { parse as parseExif } from 'exifr';
import sharp from 'sharp';
import { DrizzleService } from '../db/drizzle.service';
import {
  NotificationType,
  PhotoStatus,
  events,
  faceRecords,
  photoMetadata,
  photos,
} from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { FaceEngine } from '../faces/face-engine';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { encryptEmbedding, parseEncryptionKey } from '../common/utils/crypto.util';
import {
  previewKey,
  thumbnailKey,
} from '../common/utils/storage-keys';

export interface PhotoJobData {
  photoId: string;
  eventId: string;
  studioId: string;
}

@Injectable()
export class PhotoProcessor {
  private readonly logger = new Logger(PhotoProcessor.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly storage: StorageService,
    private readonly storageUsage: StorageUsageService,
    private readonly engine: FaceEngine,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async handle(job: Job<PhotoJobData>): Promise<void> {
    const { photoId, eventId, studioId } = job.data;
    const photo = await this.database.db.query.photos.findFirst({
      where: eq(photos.id, photoId),
      with: { event: { columns: { id: true, studioId: true, name: true } } },
    });
    if (!photo || photo.event.studioId !== studioId || photo.eventId !== eventId) {
      this.logger.warn(`Skipping photo job for missing/foreign photo ${photoId}`);
      return;
    }

    await this.database.db
      .update(photos)
      .set({ status: PhotoStatus.PROCESSING, processingError: null })
      .where(eq(photos.id, photoId));
    this.realtime.emitToStudio(studioId, 'photo.processing', { photoId, eventId });

    try {
      const original = await this.storage.getBuffer(photo.storageKey);
      const metadata = await sharp(original).metadata();
      if (!metadata.format) throw new Error('Invalid image');
      const exif = (await parseExif(original, {
        pick: [
          'Make',
          'Model',
          'LensModel',
          'ISO',
          'FNumber',
          'ExposureTime',
          'FocalLength',
          'Orientation',
          'DateTimeOriginal',
        ],
      }).catch(() => undefined)) as Record<string, unknown> | undefined;

      const thumbKey = thumbnailKey(studioId, eventId, photoId);
      const previewObjectKey = previewKey(studioId, eventId, photoId);

      const [thumbnail, preview, faces] = await Promise.all([
        sharp(original)
          .rotate()
          .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer(),
        sharp(original)
          .rotate()
          .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer(),
        this.engine.detect(original, { mode: 'index' }),
      ]);

      await Promise.all([
        this.storage.upload(thumbKey, thumbnail, 'image/webp'),
        this.storage.upload(previewObjectKey, preview, 'image/webp'),
      ]);
      await Promise.all([
        this.storageUsage.record({
          studioId,
          eventId,
          photoId,
          key: thumbKey,
          kind: 'THUMBNAIL',
          bytes: thumbnail.byteLength,
          contentType: 'image/webp',
        }),
        this.storageUsage.record({
          studioId,
          eventId,
          photoId,
          key: previewObjectKey,
          kind: 'PREVIEW',
          bytes: preview.byteLength,
          contentType: 'image/webp',
        }),
      ]);

      const encryptionKey = parseEncryptionKey(
        this.config.getOrThrow<string>('biometricEncryptionKey'),
      );
      const faceRows = faces.map((face) => {
        const id = createId();
        return {
          id,
          photoId,
          eventId,
          boundingBox: face.boundingBox,
          confidence: face.confidence,
          embedding: encryptEmbedding(face.embedding, encryptionKey, `${eventId}:${photoId}:${id}`),
          embeddingModel: this.engine.version,
          embeddingDim: face.embedding.length,
        };
      });

      const width = metadata.width ?? null;
      const height = metadata.height ?? null;
      const orientation = metadata.orientation ?? 1;
      const displayWidth = orientation >= 5 && orientation <= 8 ? height : width;
      const displayHeight = orientation >= 5 && orientation <= 8 ? width : height;
      const takenAt =
        exif?.DateTimeOriginal instanceof Date && !Number.isNaN(exif.DateTimeOriginal.getTime())
          ? exif.DateTimeOriginal
          : null;

      const shutter =
        typeof exif?.ExposureTime === 'number'
          ? exif.ExposureTime < 1
            ? `1/${Math.round(1 / exif.ExposureTime)}`
            : `${exif.ExposureTime}s`
          : null;

      const metadataValues = {
        cameraMake: typeof exif?.Make === 'string' ? exif.Make.slice(0, 100) : null,
        cameraModel: typeof exif?.Model === 'string' ? exif.Model.slice(0, 100) : null,
        lens: typeof exif?.LensModel === 'string' ? exif.LensModel.slice(0, 120) : null,
        iso: typeof exif?.ISO === 'number' ? Math.round(exif.ISO) : null,
        aperture: typeof exif?.FNumber === 'number' ? exif.FNumber : null,
        shutterSpeed: shutter,
        focalLength:
          typeof exif?.FocalLength === 'number' ? Number(exif.FocalLength) : null,
        orientation: typeof orientation === 'number' ? orientation : null,
        exif: {
          cameraMake: exif?.Make ?? null,
          cameraModel: exif?.Model ?? null,
          lens: exif?.LensModel ?? null,
          iso: exif?.ISO ?? null,
          aperture: exif?.FNumber ?? null,
          exposureTime: exif?.ExposureTime ?? null,
          focalLength: exif?.FocalLength ?? null,
        },
      };

      await this.database.db.transaction(async (tx) => {
        const removedFaces = await tx
          .delete(faceRecords)
          .where(eq(faceRecords.photoId, photoId))
          .returning({ id: faceRecords.id });
        const previousFaceCount = removedFaces.length;
        if (faceRows.length) {
          await tx.insert(faceRecords).values(faceRows);
        }

        await tx
          .update(photos)
          .set({
            status: PhotoStatus.READY,
            processingError: null,
            thumbnailKey: thumbKey,
            previewKey: previewObjectKey,
            width: displayWidth,
            height: displayHeight,
            faceCount: faceRows.length,
            takenAt: takenAt ?? undefined,
          })
          .where(eq(photos.id, photoId));

        await tx
          .insert(photoMetadata)
          .values({ photoId, ...metadataValues })
          .onConflictDoUpdate({
            target: photoMetadata.photoId,
            set: metadataValues,
          });

        if (faceRows.length !== previousFaceCount) {
          const delta = faceRows.length - previousFaceCount;
          await tx
            .update(events)
            .set({ faceCount: sql`${events.faceCount} + ${delta}` })
            .where(eq(events.id, eventId));
        }
      });

      this.realtime.emitToStudio(studioId, 'photo.ready', {
        photoId,
        eventId,
        status: PhotoStatus.READY,
        faceCount: faceRows.length,
      });
      this.realtime.emitToStudio(studioId, 'gallery.updated', { eventId, photoId });
      this.realtime.emitToEventGuests(eventId, 'gallery.new_photos', {
        eventId,
        message: 'New photographs were added to this event.',
      });
    } catch (error) {
      const message = (error as Error).message?.slice(0, 500) ?? 'Processing failed';
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      await this.database.db
        .update(photos)
        .set({
          status: isFinalAttempt ? PhotoStatus.FAILED : PhotoStatus.PROCESSING,
          processingError: message,
        })
        .where(eq(photos.id, photoId))
        .catch(() => undefined);

      if (!isFinalAttempt) {
        this.logger.warn(`Photo ${photoId} attempt ${job.attemptsMade + 1} failed: ${message}`);
        throw error;
      }

      this.logger.error(`Photo ${photoId} processing failed permanently: ${message}`);
      this.realtime.emitToStudio(studioId, 'photo.failed', { photoId, eventId, message });
      await this.notifications
        .create({
          studioId,
          eventId,
          type: NotificationType.PROCESSING_FAILED,
          title: 'A photo could not be processed',
          body: `${photo.originalFilename} failed AI processing. You can retry it from the photo library.`,
          data: { photoId, eventId },
        })
        .catch(() => undefined);
    }
  }
}
