import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull, sql, sum } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service';
import { StorageKind, storageObjects, studios } from '../db/schema';

export interface RecordStorageInput {
  studioId: string;
  eventId?: string | null;
  photoId?: string | null;
  key: string;
  kind: StorageKind;
  bytes: number;
  contentType: string;
}

/**
 * The studio's cached byte counter powers plan enforcement and dashboards.
 * Actual object metadata lives in StorageObject so usage can be recomputed.
 */
@Injectable()
export class StorageUsageService {
  constructor(private readonly database: DrizzleService) {}

  async record(input: RecordStorageInput): Promise<void> {
    const [existing] = await this.database.db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.key, input.key))
      .limit(1);

    if (!existing) {
      await this.database.db.transaction(async (tx) => {
        await tx.insert(storageObjects).values({
          studioId: input.studioId,
          eventId: input.eventId ?? null,
          photoId: input.photoId ?? null,
          key: input.key,
          kind: input.kind,
          bytes: input.bytes,
          contentType: input.contentType,
        });
        await tx
          .update(studios)
          .set({
            storageUsedBytes: sql`${studios.storageUsedBytes} + ${Math.max(0, input.bytes)}`,
          })
          .where(eq(studios.id, input.studioId));
      });
      return;
    }

    const wasActive = !existing.deletedAt;
    const delta = input.bytes - (wasActive ? existing.bytes : 0);
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(storageObjects)
        .set({
          deletedAt: null,
          bytes: input.bytes,
          kind: input.kind,
          contentType: input.contentType,
          studioId: input.studioId,
          eventId: input.eventId ?? existing.eventId,
          photoId: input.photoId ?? existing.photoId,
        })
        .where(eq(storageObjects.key, input.key));
      await tx
        .update(studios)
        .set({ storageUsedBytes: sql`${studios.storageUsedBytes} + ${delta}` })
        .where(eq(studios.id, input.studioId));
    });
  }

  async removeKey(key: string): Promise<number> {
    const [object] = await this.database.db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.key, key))
      .limit(1);
    if (!object || object.deletedAt) return 0;
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(storageObjects)
        .set({ deletedAt: new Date() })
        .where(eq(storageObjects.key, key));
      await tx
        .update(studios)
        .set({
          storageUsedBytes: sql`${studios.storageUsedBytes} - ${object.bytes}`,
        })
        .where(eq(studios.id, object.studioId));
    });
    return object.bytes;
  }

  async removeKeys(keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      removed += await this.removeKey(key);
    }
    return removed;
  }

  async removeForPhoto(photoId: string): Promise<number> {
    const objects = await this.database.db
      .select({ key: storageObjects.key, bytes: storageObjects.bytes, studioId: storageObjects.studioId })
      .from(storageObjects)
      .where(and(eq(storageObjects.photoId, photoId), isNull(storageObjects.deletedAt)));
    return this.removeObjects(objects);
  }

  async removeForEvent(eventId: string): Promise<number> {
    const objects = await this.database.db
      .select({ key: storageObjects.key, bytes: storageObjects.bytes, studioId: storageObjects.studioId })
      .from(storageObjects)
      .where(and(eq(storageObjects.eventId, eventId), isNull(storageObjects.deletedAt)));
    return this.removeObjects(objects);
  }

  private async removeObjects(
    objects: { key: string; bytes: number; studioId: string }[],
  ): Promise<number> {
    if (!objects.length) return 0;
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(storageObjects)
        .set({ deletedAt: now })
        .where(
          and(
            inArray(
              storageObjects.key,
              objects.map((object) => object.key),
            ),
            isNull(storageObjects.deletedAt),
          ),
        );
      for (const studioId of Array.from(new Set(objects.map((object) => object.studioId)))) {
        const bytes = objects
          .filter((object) => object.studioId === studioId)
          .reduce((sum, object) => sum + object.bytes, 0);
        await tx
          .update(studios)
          .set({ storageUsedBytes: sql`${studios.storageUsedBytes} - ${bytes}` })
          .where(eq(studios.id, studioId));
      }
    });
    return objects.reduce((sum, object) => sum + object.bytes, 0);
  }

  async recompute(studioId: string): Promise<number> {
    const [result] = await this.database.db
      .select({ total: sum(storageObjects.bytes) })
      .from(storageObjects)
      .where(and(eq(storageObjects.studioId, studioId), isNull(storageObjects.deletedAt)));
    const total = Number(result?.total ?? 0);
    await this.database.db
      .update(studios)
      .set({ storageUsedBytes: Math.max(0, total) })
      .where(eq(studios.id, studioId));
    return Math.max(0, total);
  }

  async summary(studioId: string): Promise<
    { kind: StorageKind; bytes: number; count: number }[]
  > {
    const groups = await this.database.db
      .select({
        kind: storageObjects.kind,
        bytes: sum(storageObjects.bytes),
        count: count(),
      })
      .from(storageObjects)
      .where(and(eq(storageObjects.studioId, studioId), isNull(storageObjects.deletedAt)))
      .groupBy(storageObjects.kind);
    return groups.map((group) => ({
      kind: group.kind,
      bytes: Number(group.bytes ?? 0),
      count: Number(group.count),
    }));
  }
}
