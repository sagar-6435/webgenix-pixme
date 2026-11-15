import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, gt, notInArray } from 'drizzle-orm';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import { DrizzleService } from '../db/drizzle.service';
import {
  EventStatus,
  GuestSessionStatus,
  faceRecords,
  favorites,
  guestSessions,
  matchingResults,
} from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { FaceEngine } from '../faces/face-engine';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  euclideanDistance,
  type Embedding,
} from '../common/utils/embedding.util';
import {
  decryptEmbedding,
  parseEncryptionKey,
} from '../common/utils/crypto.util';

export interface GuestMatchJobData {
  guestSessionId: string;
}

class GuestMatchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  NO_FACE: "We couldn't find a face. Face the camera in good light and try again.",
  MULTIPLE_FACES: 'We can see more than one face. Please make sure only you are in the photo.',
  NO_SELFIE: 'Your selfie expired before it could be processed. Please take another one.',
  LOW_QUALITY: 'Your face is not clear enough. Move into better light and try again.',
  MOVE_CLOSER: 'Move a little closer to the camera and try again.',
  LOW_LIGHT: 'It is too dark to see your face clearly. Find better light and try again.',
  GALLERY_CLOSED: 'This event gallery is no longer accepting face matches.',
};

@Injectable()
export class GuestMatchProcessor {
  private readonly logger = new Logger(GuestMatchProcessor.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly storage: StorageService,
    private readonly storageUsage: StorageUsageService,
    private readonly engine: FaceEngine,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  async handle(job: Job<GuestMatchJobData>): Promise<void> {
    const sessionId = job.data.guestSessionId;
    const session = await this.database.db.query.guestSessions.findFirst({
      where: eq(guestSessions.id, sessionId),
      with: { event: { with: { settings: true } } },
    });
    if (!session) return;

    if (
      session.status === GuestSessionStatus.REVOKED ||
      session.status === GuestSessionStatus.EXPIRED ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      await this.cleanupSelfie(session.id);
      return;
    }

    if (
      session.event.status === EventStatus.ARCHIVED ||
      (session.event.galleryExpiresAt && session.event.galleryExpiresAt.getTime() < Date.now())
    ) {
      await this.cleanupSelfie(session.id);
      await this.database.db
        .update(guestSessions)
        .set({ status: GuestSessionStatus.EXPIRED, errorCode: 'GALLERY_CLOSED' })
        .where(
          and(
            eq(guestSessions.id, sessionId),
            notInArray(guestSessions.status, [
              GuestSessionStatus.REVOKED,
              GuestSessionStatus.EXPIRED,
            ]),
          ),
        );
      this.realtime.emitToGuest(sessionId, 'guest.match.failed', {
        code: 'GALLERY_CLOSED',
        message: FRIENDLY_MESSAGES.GALLERY_CLOSED,
      });
      return;
    }

    await this.database.db
      .update(guestSessions)
      .set({
        status: GuestSessionStatus.PROCESSING,
        matchingStartedAt: new Date(),
        matchingCompletedAt: null,
        errorCode: null,
      })
      .where(eq(guestSessions.id, sessionId));
    this.realtime.emitToGuest(sessionId, 'guest.match.processing', { status: 'PROCESSING' });

    try {
      const selfieKey = session.selfieObjectKey;
      if (!selfieKey) {
        throw new GuestMatchError('NO_SELFIE', FRIENDLY_MESSAGES.NO_SELFIE);
      }

      let image: Buffer;
      try {
        image = await this.storage.getBuffer(selfieKey);
      } catch {
        throw new GuestMatchError('NO_SELFIE', FRIENDLY_MESSAGES.NO_SELFIE);
      } finally {
        // The selfie is deleted before any embedding work begins. Only the
        // in-memory buffer survives, and it is discarded with this request.
        await this.cleanupSelfie(sessionId);
      }

      const settings = session.event.settings;
      const stats = await sharp(image).greyscale().stats();
      const brightness = stats.channels[0]?.mean ?? 128;
      if (brightness < 28) {
        throw new GuestMatchError('LOW_LIGHT', FRIENDLY_MESSAGES.LOW_LIGHT);
      }

      const faces = await this.engine.detect(image, { mode: 'selfie' });
      if (faces.length === 0) {
        throw new GuestMatchError('NO_FACE', FRIENDLY_MESSAGES.NO_FACE);
      }
      if (faces.length > 1) {
        throw new GuestMatchError('MULTIPLE_FACES', FRIENDLY_MESSAGES.MULTIPLE_FACES);
      }

      const face = faces[0];
      if (face.confidence < (settings?.minFaceConfidence ?? 0.65)) {
        throw new GuestMatchError('LOW_QUALITY', FRIENDLY_MESSAGES.LOW_QUALITY);
      }
      if (face.boundingBox.width * face.boundingBox.height < 0.008) {
        throw new GuestMatchError('MOVE_CLOSER', FRIENDLY_MESSAGES.MOVE_CLOSER);
      }

      const threshold = Math.min(
        0.7,
        Math.max(0.3, settings?.matchThreshold ?? this.config.get<number>('ai.matchThreshold') ?? 0.52),
      );
      const maxPhotos = Math.max(1, settings?.maxPhotosPerMatch ?? 500);
      const query = new Float32Array(face.embedding);
      const encryptionKey = parseEncryptionKey(
        this.config.getOrThrow<string>('biometricEncryptionKey'),
      );

      const bestByPhoto = new Map<string, { distance: number; confidence: number }>();
      let cursor: string | undefined;
      let scanned = 0;
      let decryptFailures = 0;

      do {
        const records = await this.database.db
          .select({
            id: faceRecords.id,
            photoId: faceRecords.photoId,
            embedding: faceRecords.embedding,
          })
          .from(faceRecords)
          .where(
            and(
              eq(faceRecords.eventId, session.eventId),
              cursor ? gt(faceRecords.id, cursor) : undefined,
            ),
          )
          .orderBy(asc(faceRecords.id))
          .limit(1000);

        for (const record of records) {
          scanned += 1;
          let embedding: Float32Array;
          try {
            embedding = decryptEmbedding(
              record.embedding,
              encryptionKey,
              `${session.eventId}:${record.photoId}:${record.id}`,
            );
          } catch {
            decryptFailures += 1;
            continue;
          }
          const distance = euclideanDistance(embedding as unknown as Embedding, query);
          if (!Number.isFinite(distance) || distance > threshold) continue;
          const previous = bestByPhoto.get(record.photoId);
          if (!previous || distance < previous.distance) {
            bestByPhoto.set(record.photoId, {
              distance,
              confidence: Math.round(Math.max(0, Math.min(1, 1 - distance)) * 10000) / 10000,
            });
          }
        }

        cursor = records.length > 0 ? records[records.length - 1].id : undefined;
        if (records.length < 1000) break;
      } while (cursor);

      if (decryptFailures > 0) {
        this.logger.warn(
          `${decryptFailures} face records could not be decrypted for event ${session.eventId}`,
        );
      }

      const matches = Array.from(bestByPhoto.entries())
        .map(([photoId, match]) => ({ photoId, ...match }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxPhotos);

      const completedAt = new Date();
      await this.database.db.transaction(async (tx) => {
        await tx.delete(matchingResults).where(eq(matchingResults.guestSessionId, sessionId));
        await tx.delete(favorites).where(eq(favorites.guestSessionId, sessionId));
        if (matches.length) {
          await tx
            .insert(matchingResults)
            .values(
              matches.map((match) => ({
                guestSessionId: sessionId,
                eventId: session.eventId,
                photoId: match.photoId,
                distance: match.distance,
                confidence: match.confidence,
              })),
            )
            .onConflictDoNothing();
        }
        await tx
          .update(guestSessions)
          .set({
            status:
              matches.length > 0 ? GuestSessionStatus.MATCHED : GuestSessionStatus.NO_MATCHES,
            matchCount: matches.length,
            matchThreshold: threshold,
            matchingCompletedAt: completedAt,
            errorCode: null,
          })
          .where(eq(guestSessions.id, sessionId));
      });

      this.logger.log(
        `Guest matching completed event=${session.eventId} scanned=${scanned} matches=${matches.length}`,
      );
      this.realtime.emitToGuest(sessionId, 'guest.match.completed', {
        status: matches.length > 0 ? 'MATCHED' : 'NO_MATCHES',
        matchCount: matches.length,
        completedAt,
      });
    } catch (error) {
      const code = error instanceof GuestMatchError ? error.code : 'PROCESSING_FAILED';
      const message =
        error instanceof GuestMatchError
          ? error.message
          : 'We could not process that selfie. Please try again.';
      this.logger.warn(
        `Guest matching failed for session ${sessionId}: ${code} ${(error as Error).message}`,
      );
      await this.database.db
        .update(guestSessions)
        .set({
          status: GuestSessionStatus.FAILED,
          errorCode: code,
          matchingCompletedAt: new Date(),
        })
        .where(
          and(
            eq(guestSessions.id, sessionId),
            notInArray(guestSessions.status, [
              GuestSessionStatus.REVOKED,
              GuestSessionStatus.EXPIRED,
            ]),
          ),
        )
        .catch(() => undefined);
      this.realtime.emitToGuest(sessionId, 'guest.match.failed', { code, message });
    } finally {
      await this.cleanupSelfie(sessionId);
    }
  }

  private async cleanupSelfie(sessionId: string): Promise<void> {
    const [session] = await this.database.db
      .select({ selfieObjectKey: guestSessions.selfieObjectKey })
      .from(guestSessions)
      .where(eq(guestSessions.id, sessionId))
      .limit(1);
    if (!session?.selfieObjectKey) return;
    const key = session.selfieObjectKey;
    await this.storage.remove(key).catch(() => undefined);
    await this.storageUsage.removeKey(key).catch(() => undefined);
    await this.database.db
      .update(guestSessions)
      .set({ selfieObjectKey: null, selfieDeletedAt: new Date() })
      .where(and(eq(guestSessions.id, sessionId), eq(guestSessions.selfieObjectKey, key)));
  }
}
