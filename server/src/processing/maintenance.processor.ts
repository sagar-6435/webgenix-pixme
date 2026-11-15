import { Injectable, Logger } from '@nestjs/common';
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  lt,
  notInArray,
  or,
} from 'drizzle-orm';
import type { Job } from 'bullmq';
import { DrizzleService } from '../db/drizzle.service';
import {
  GuestSessionStatus,
  PhotoStatus,
  events,
  favorites,
  guestSessions,
  matchingResults,
  photos,
  shareLinks,
  verificationTokens,
} from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  biometricPrefix,
  eventStoragePrefix,
} from '../common/utils/storage-keys';

export type MaintenanceJobData =
  | { type: 'cleanup-guest-data' }
  | { type: 'cleanup-biometric' }
  | { type: 'delete-event'; eventId: string; studioId: string };

@Injectable()
export class MaintenanceProcessor {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly storage: StorageService,
    private readonly storageUsage: StorageUsageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async handle(job: Job<MaintenanceJobData>): Promise<unknown> {
    switch (job.data.type) {
      case 'cleanup-guest-data':
        return this.cleanupGuestData();
      case 'cleanup-biometric':
        return this.cleanupBiometric();
      case 'delete-event':
        return this.deleteEvent(job.data.eventId, job.data.studioId);
      default:
        return null;
    }
  }

  async cleanupGuestData(): Promise<{ expired: number; purged: number }> {
    const now = new Date();
    const expired = await this.database.db
      .select({
        id: guestSessions.id,
        selfieObjectKey: guestSessions.selfieObjectKey,
        eventId: guestSessions.eventId,
      })
      .from(guestSessions)
      .where(
        and(
          lt(guestSessions.expiresAt, now),
          notInArray(guestSessions.status, [
            GuestSessionStatus.EXPIRED,
            GuestSessionStatus.REVOKED,
          ]),
        ),
      )
      .limit(1000);

    if (expired.length) {
      const ids = expired.map((session) => session.id);
      for (const session of expired) {
        if (session.selfieObjectKey) {
          await this.storage.remove(session.selfieObjectKey).catch(() => undefined);
          await this.storageUsage.removeKey(session.selfieObjectKey).catch(() => undefined);
        }
      }
      await this.database.db.transaction(async (tx) => {
        await tx.delete(matchingResults).where(inArray(matchingResults.guestSessionId, ids));
        await tx.delete(favorites).where(inArray(favorites.guestSessionId, ids));
        await tx
          .update(guestSessions)
          .set({
            status: GuestSessionStatus.EXPIRED,
            selfieObjectKey: null,
            selfieDeletedAt: now,
          })
          .where(inArray(guestSessions.id, ids));
      });
      for (const session of expired) {
        this.realtime.emitToGuest(session.id, 'guest.session.expired', {
          eventId: session.eventId,
          message: 'Your private gallery session has expired.',
        });
      }
    }

    // Remove stale matching data left behind for sessions already expired.
    const staleSessions = await this.database.db
      .select({ id: guestSessions.id })
      .from(guestSessions)
      .where(
        and(
          inArray(guestSessions.status, [
            GuestSessionStatus.EXPIRED,
            GuestSessionStatus.REVOKED,
          ]),
          or(
            exists(
              this.database.db
                .select({ id: matchingResults.id })
                .from(matchingResults)
                .where(eq(matchingResults.guestSessionId, guestSessions.id)),
            ),
            exists(
              this.database.db
                .select({ id: favorites.id })
                .from(favorites)
                .where(eq(favorites.guestSessionId, guestSessions.id)),
            ),
          ),
        ),
      )
      .limit(1000);
    if (staleSessions.length) {
      const ids = staleSessions.map((session) => session.id);
      await this.database.db.transaction(async (tx) => {
        await tx.delete(matchingResults).where(inArray(matchingResults.guestSessionId, ids));
        await tx.delete(favorites).where(inArray(favorites.guestSessionId, ids));
      });
    }

    await this.database.db
      .delete(verificationTokens)
      .where(lt(verificationTokens.expiresAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    await this.database.db
      .delete(shareLinks)
      .where(lt(shareLinks.expiresAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));

    return { expired: expired.length, purged: staleSessions.length };
  }

  async cleanupBiometric(): Promise<{ selfies: number; orphans: number }> {
    const now = new Date();
    const sessions = await this.database.db.query.guestSessions.findMany({
      where: isNotNull(guestSessions.selfieObjectKey),
      columns: {
        id: true,
        selfieObjectKey: true,
        selfieDeletedAt: true,
        lastSelfieAt: true,
        status: true,
      },
      with: {
        event: {
          columns: { studioId: true },
          with: { settings: { columns: { selfieRetentionMinutes: true } } },
        },
      },
    });

    const affectedStudios = new Set<string>();
    let removed = 0;
    for (const session of sessions) {
      if (!session.selfieObjectKey) continue;
      const key = session.selfieObjectKey;
      const retention = session.event.settings?.selfieRetentionMinutes ?? 15;
      const reference = session.lastSelfieAt ?? session.selfieDeletedAt ?? new Date(0);
      if (reference.getTime() > now.getTime() - retention * 60_000) continue;

      await this.storage.remove(key).catch(() => undefined);
      await this.storageUsage.removeKey(key).catch(() => undefined);
      affectedStudios.add(session.event.studioId);
      removed += 1;

      const isProcessing = session.status === GuestSessionStatus.PROCESSING;
      await this.database.db
        .update(guestSessions)
        .set({
          selfieObjectKey: null,
          selfieDeletedAt: now,
          ...(isProcessing
            ? {
                status: GuestSessionStatus.FAILED,
                errorCode: 'SELFIE_EXPIRED',
                matchingCompletedAt: now,
              }
            : {}),
        })
        .where(and(eq(guestSessions.id, session.id), eq(guestSessions.selfieObjectKey, key)));
      if (isProcessing) {
        this.realtime.emitToGuest(session.id, 'guest.match.failed', {
          code: 'SELFIE_EXPIRED',
          message: 'Your selfie expired before it could be analyzed. Please try again.',
        });
      }
    }

    // Orphan objects from crashed requests are purged after one hour. The
    // bucket lifecycle rule is a second line of defense (24h).
    let orphans = 0;
    const objects = await this.storage.listKeys(biometricPrefix());
    const cutoff = now.getTime() - 60 * 60 * 1000;
    for (const object of objects) {
      if (!object.lastModified || object.lastModified.getTime() > cutoff) continue;
      await this.storage.remove(object.key).catch(() => undefined);
      await this.storageUsage.removeKey(object.key).catch(() => undefined);
      orphans += 1;
    }

    for (const studioId of affectedStudios) {
      await this.storageUsage.recompute(studioId).catch(() => undefined);
    }
    if (removed || orphans) {
      this.logger.log(`Biometric cleanup removed ${removed} selfies and ${orphans} orphan objects`);
    }
    return { selfies: removed, orphans };
  }

  async deleteEvent(eventId: string, studioId: string): Promise<{ deleted: boolean }> {
    const event = await this.database.db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.studioId, studioId)),
      columns: { id: true, name: true, studioId: true },
    });
    if (!event) return { deleted: false };

    await this.storage.removePrefix(eventStoragePrefix(studioId, eventId));
    await this.storage.removePrefix(biometricPrefix(eventId));
    await this.storageUsage.removeForEvent(eventId);

    const deleted = await this.database.db
      .delete(events)
      .where(and(eq(events.id, eventId), eq(events.studioId, studioId)))
      .returning({ id: events.id });
    if (!deleted.length) return { deleted: false };
    await this.storageUsage.recompute(studioId);

    this.realtime.emitToStudio(studioId, 'event.deleted', { eventId });
    this.logger.log(`Deleted event ${event.name} (${eventId}) and its objects`);
    return { deleted: true };
  }

  /** Can be called from an admin action to repair usage drift. */
  async recomputeStudioUsage(studioId: string): Promise<number> {
    return this.storageUsage.recompute(studioId);
  }

  async resetStuckPhotos(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const rows = await this.database.db
      .update(photos)
      .set({ status: PhotoStatus.FAILED, processingError: 'Processing timed out' })
      .where(and(eq(photos.status, PhotoStatus.PROCESSING), lt(photos.updatedAt, cutoff)))
      .returning({ id: photos.id });
    return rows.length;
  }
}
