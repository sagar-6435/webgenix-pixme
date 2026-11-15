import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  EventStatus,
  GuestSessionStatus,
  StorageKind,
  events,
  favorites,
  guestConsents,
  guestSessions,
  matchingResults,
  photos,
  shareLinks,
  downloads,
} from '../db/schema';
import sharp from 'sharp';
import { DrizzleService } from '../db/drizzle.service';
import { StorageService } from '../storage/storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { ProcessingService } from '../processing/processing.service';
import { AuditService } from '../audit/audit.service';
import { sha256, hashToken, randomToken, sanitizeFilename } from '../common/utils/crypto.util';
import { guestSelfieKey } from '../common/utils/storage-keys';
import { paginate } from '../common/utils/pagination.util';
import type { CreateGuestSessionDto, GuestMatchListQueryDto } from './dto/guest.dto';
import {
  DEFAULT_CONSENT_TEXT,
  GUEST_ERROR_MESSAGES,
  type GuestRequestContext,
} from './guest.types';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const ALLOWED_SELFIE_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff']);
const MAX_BULK_PHOTOS = 100;

@Injectable()
export class GuestService {
  private readonly logger = new Logger(GuestService.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
    private readonly storageUsage: StorageUsageService,
    private readonly processing: ProcessingService,
    private readonly audit: AuditService,
  ) {}

  private hash(value: string | undefined): string | null {
    if (!value) return null;
    return hashToken(value, this.config.getOrThrow<string>('jwt.refreshPepper'));
  }

  async createSession(slug: string, dto: CreateGuestSessionDto, meta: RequestMeta) {
    const event = await this.database.db.query.events.findFirst({
      where: and(eq(events.slug, slug), eq(events.status, EventStatus.PUBLISHED)),
      with: { settings: true },
    });
    if (!event) throw new NotFoundException('This event could not be found');
    if (event.galleryExpiresAt && event.galleryExpiresAt.getTime() < Date.now()) {
      throw new ForbiddenException({
        code: 'GALLERY_CLOSED',
        message: 'This event gallery is no longer accepting face matches.',
      });
    }

    const version = event.settings?.consentVersion ?? '2026-01';
    if (dto.consentVersion !== version) {
      throw new BadRequestException({
        code: 'CONSENT_VERSION_CHANGED',
        message: 'The privacy notice has been updated. Please review and accept it again.',
      });
    }

    const minutes = Math.min(720, Math.max(15, event.settings?.guestSessionMinutes ?? 120));
    const consentText = event.settings?.consentText?.trim() || DEFAULT_CONSENT_TEXT;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const ipHash = this.hash(meta.ip);
    const userAgentHash = this.hash(meta.userAgent);

    const session = await this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(guestSessions)
        .values({
          eventId: event.id,
          status: GuestSessionStatus.CONSENTED,
          expiresAt,
          ipHash,
          userAgentHash,
        })
        .returning();
      await tx.insert(guestConsents).values({
        eventId: event.id,
        guestSessionId: created.id,
        consentVersion: version,
        consentTextHash: sha256(`${version}:${consentText}`),
        ipHash,
        userAgentHash,
      });
      await tx
        .update(events)
        .set({ guestCount: sql`${events.guestCount} + 1` })
        .where(eq(events.id, event.id));
      return created;
    });

    const token = await this.jwt.signAsync(
      { sub: session.id, typ: 'guest', eventId: event.id },
      {
        secret: this.config.getOrThrow<string>('jwt.guestSecret'),
        expiresIn: minutes * 60,
      },
    );

    await this.audit.record({
      studioId: event.studioId,
      action: 'GUEST_CONSENT_ACCEPTED',
      entity: 'guest_session',
      entityId: session.id,
      metadata: { eventId: event.id, consentVersion: version },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      token,
      tokenType: 'Bearer',
      expiresIn: minutes * 60,
      expiresAt,
      session: {
        id: session.id,
        status: session.status,
        consentAt: session.consentAt,
        expiresAt,
        consentVersion: version,
      },
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        category: event.category,
        brandColor: event.brandColor,
        startAt: event.startAt,
        location: { name: event.locationName, city: event.city },
      },
    };
  }

  async getSession(guest: GuestRequestContext) {
    const session = await this.database.db.query.guestSessions.findFirst({
      where: eq(guestSessions.id, guest.id),
      with: {
        event: {
          with: {
            settings: true,
            studio: { columns: { name: true, brandColor: true, logoKey: true } },
          },
        },
        consent: true,
      },
    });
    if (!session) throw new NotFoundException('Guest session not found');

    return {
      id: session.id,
      status: session.status,
      consentAt: session.consentAt,
      expiresAt: session.expiresAt,
      matchCount: session.matchCount,
      matchThreshold: session.matchThreshold,
      matchingStartedAt: session.matchingStartedAt,
      matchingCompletedAt: session.matchingCompletedAt,
      selfieDeletedAt: session.selfieDeletedAt,
      errorCode: session.errorCode,
      errorMessage: session.errorCode
        ? (GUEST_ERROR_MESSAGES[session.errorCode] ?? GUEST_ERROR_MESSAGES.PROCESSING_FAILED)
        : null,
      consent: session.consent
        ? {
            version: session.consent.consentVersion,
            acceptedAt: session.consent.acceptedAt,
            withdrawnAt: session.consent.withdrawnAt,
          }
        : null,
      event: {
        id: session.event.id,
        name: session.event.name,
        slug: session.event.slug,
        category: session.event.category,
        startAt: session.event.startAt,
        locationName: session.event.locationName,
        city: session.event.city,
        brandColor: session.event.brandColor,
        coverUrl: await this.signed(session.event.coverImageKey),
        studio: {
          name: session.event.studio.name,
          brandColor: session.event.studio.brandColor,
          logoUrl: await this.signed(session.event.studio.logoKey),
        },
      },
      permissions: {
        allowDownloads: session.event.settings?.allowDownloads ?? true,
        allowFavorites: session.event.settings?.allowFavorites ?? true,
        allowGuestSharing: session.event.settings?.allowGuestSharing ?? false,
      },
      privacy: {
        selfieDeletedImmediately: true,
        biometricTemplateStored: false,
        sessionMinutes: guest.settings.guestSessionMinutes,
      },
    };
  }

  async uploadSelfie(
    guest: GuestRequestContext,
    file: Express.Multer.File | undefined,
    meta: RequestMeta,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Take a selfie to find your photographs');
    }

    const session = await this.database.db.query.guestSessions.findFirst({
      where: eq(guestSessions.id, guest.id),
      with: {
        event: {
          with: {
            settings: true,
            studio: { columns: { id: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Guest session not found');
    if (session.status === GuestSessionStatus.PROCESSING) {
      throw new ConflictException({
        code: 'SELFIE_ALREADY_PROCESSING',
        message: 'Your selfie is already being analysed. Give us a moment.',
      });
    }

    const metadata = await sharp(file.buffer).metadata().catch(() => null);
    if (!metadata?.format || !ALLOWED_SELFIE_FORMATS.has(metadata.format)) {
      throw new BadRequestException('Use a JPEG, PNG, WebP, or HEIC selfie');
    }
    if ((metadata.width ?? 0) < 240 || (metadata.height ?? 0) < 240) {
      throw new BadRequestException('That image is too small. Take a clearer selfie.');
    }

    // Re-encoding strips EXIF/GPS metadata and normalises orientation. The
    // selfie never reaches the database or long-term object storage.
    let processed: Buffer;
    try {
      processed = await sharp(file.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new BadRequestException('That selfie could not be read. Please take another one.');
    }
    if (processed.byteLength > 12 * 1024 * 1024) {
      throw new BadRequestException('That selfie is too large. Please take another one.');
    }

    if (session.selfieObjectKey) {
      await this.storage.remove(session.selfieObjectKey).catch(() => undefined);
      await this.storageUsage.removeKey(session.selfieObjectKey).catch(() => undefined);
    }

    const key = guestSelfieKey(guest.eventId, guest.id);
    await this.storage.upload(key, processed, 'image/jpeg', {
      'event-id': guest.eventId,
      'guest-session-id': guest.id,
      purpose: 'ephemeral-face-matching',
    });
    await this.storageUsage.record({
      studioId: session.event.studioId,
      eventId: guest.eventId,
      key,
      kind: StorageKind.SELFIE,
      bytes: processed.byteLength,
      contentType: 'image/jpeg',
    });

    await this.database.db
      .update(guestSessions)
      .set({
        selfieObjectKey: key,
        lastSelfieAt: new Date(),
        status: GuestSessionStatus.PROCESSING,
        matchingStartedAt: new Date(),
        matchingCompletedAt: null,
        errorCode: null,
      })
      .where(eq(guestSessions.id, guest.id));

    try {
      await this.processing.enqueueGuestMatch({ guestSessionId: guest.id });
    } catch (error) {
      this.logger.error(`Could not enqueue guest match ${guest.id}: ${(error as Error).message}`);
      await this.storage.remove(key).catch(() => undefined);
      await this.storageUsage.removeKey(key).catch(() => undefined);
      await this.database.db
        .update(guestSessions)
        .set({
          selfieObjectKey: null,
          selfieDeletedAt: new Date(),
          status: GuestSessionStatus.FAILED,
          errorCode: 'QUEUE_UNAVAILABLE',
          matchingCompletedAt: new Date(),
        })
        .where(eq(guestSessions.id, guest.id));
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: GUEST_ERROR_MESSAGES.QUEUE_UNAVAILABLE,
      });
    }

    await this.audit.record({
      studioId: session.event.studioId,
      action: 'GUEST_SELFIE_SUBMITTED',
      entity: 'guest_session',
      entityId: guest.id,
      metadata: { eventId: guest.eventId, bytes: processed.byteLength },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      status: GuestSessionStatus.PROCESSING,
      message: 'Finding your photographs. This usually takes a few seconds.',
      selfieDeletedImmediately: true,
    };
  }

  async listMatches(guest: GuestRequestContext, query: GuestMatchListQueryDto) {
    if (guest.status === GuestSessionStatus.PROCESSING) {
      throw new ConflictException({
        code: 'MATCHING_IN_PROGRESS',
        message: 'We are still finding your photographs.',
      });
    }
    if (
      guest.status !== GuestSessionStatus.MATCHED &&
      guest.status !== GuestSessionStatus.NO_MATCHES
    ) {
      throw new ForbiddenException({
        code: 'NO_MATCHES_AVAILABLE',
        message: 'Take a selfie before opening your private gallery.',
      });
    }

    const favoriteIds = query.favorites
      ? (
          await this.database.db
            .select({ photoId: favorites.photoId })
            .from(favorites)
            .where(eq(favorites.guestSessionId, guest.id))
        ).map((favorite) => favorite.photoId)
      : undefined;

    if (favoriteIds && favoriteIds.length === 0) {
      return paginate([], 0, query.page, query.limit);
    }

    const where = and(
      eq(matchingResults.guestSessionId, guest.id),
      favoriteIds ? inArray(matchingResults.photoId, favoriteIds) : undefined,
    );

    const [results, totalRows, favoriteRows] = await Promise.all([
      this.database.db
        .select({
          photoId: photos.id,
          width: photos.width,
          height: photos.height,
          takenAt: photos.createdAt,
          confidence: matchingResults.confidence,
          distance: matchingResults.distance,
          thumbnailKey: photos.thumbnailKey,
          previewKey: photos.previewKey,
          status: photos.status,
        })
        .from(matchingResults)
        .innerJoin(photos, eq(matchingResults.photoId, photos.id))
        .where(where)
        .orderBy(
          query.sort === 'newest' ? desc(photos.createdAt) : asc(matchingResults.distance),
        )
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.database.db.select({ value: count() }).from(matchingResults).where(where),
      this.database.db
        .select({ value: count() })
        .from(favorites)
        .where(eq(favorites.guestSessionId, guest.id)),
    ]);

    const favoriteSet = new Set(
      results.length
        ? (
            await this.database.db
              .select({ photoId: favorites.photoId })
              .from(favorites)
              .where(
                and(
                  eq(favorites.guestSessionId, guest.id),
                  inArray(
                    favorites.photoId,
                    results.map((result) => result.photoId),
                  ),
                ),
              )
          ).map((favorite) => favorite.photoId)
        : [],
    );

    const data = await Promise.all(
      results.map(async (result) => ({
        id: result.photoId,
        width: result.width,
        height: result.height,
        takenAt: result.takenAt,
        confidence: result.confidence,
        distance: result.distance,
        isFavorite: favoriteSet.has(result.photoId),
        thumbnailUrl: await this.signed(result.thumbnailKey),
        previewUrl: await this.signed(result.previewKey),
        downloadable: guest.settings.allowDownloads && result.status === 'READY',
      })),
    );

    const page = paginate(data, Number(totalRows[0]?.value ?? 0), query.page, query.limit);
    return {
      ...page,
      meta: {
        ...page.meta,
        favoriteCount: Number(favoriteRows[0]?.value ?? 0),
        sessionExpiresAt: guest.expiresAt,
      },
    };
  }

  async setFavorite(guest: GuestRequestContext, photoId: string, favorite: boolean) {
    if (!guest.settings.allowFavorites) {
      throw new ForbiddenException({
        code: 'FAVORITES_DISABLED',
        message: 'Favourites are disabled for this event.',
      });
    }
    await this.assertMatch(guest.id, photoId);

    if (favorite) {
      await this.database.db
        .insert(favorites)
        .values({ guestSessionId: guest.id, photoId })
        .onConflictDoNothing();
    } else {
      await this.database.db
        .delete(favorites)
        .where(and(eq(favorites.guestSessionId, guest.id), eq(favorites.photoId, photoId)));
    }
    const [favoriteRows] = await this.database.db
      .select({ value: count() })
      .from(favorites)
      .where(eq(favorites.guestSessionId, guest.id));
    return {
      photoId,
      isFavorite: favorite,
      favoriteCount: Number(favoriteRows?.value ?? 0),
    };
  }

  async downloadOne(guest: GuestRequestContext, photoId: string, meta: RequestMeta) {
    if (!guest.settings.allowDownloads) {
      throw new ForbiddenException({
        code: 'DOWNLOADS_DISABLED',
        message: 'Downloads are disabled for this event.',
      });
    }
    const result = await this.assertMatch(guest.id, photoId);

    const url = await this.storage.signedGetUrl(result.photo.storageKey, {
      ttlSeconds: 300,
      downloadName: result.photo.originalFilename,
    });
    await this.database.db.transaction(async (tx) => {
      await tx.insert(downloads).values({
        eventId: guest.eventId,
        photoId,
        guestSessionId: guest.id,
        kind: 'SINGLE',
        format: 'original',
        photoCount: 1,
        bytes: result.photo.sizeBytes,
        ipHash: this.hash(meta.ip),
      });
      await tx
        .update(events)
        .set({ downloadCount: sql`${events.downloadCount} + 1` })
        .where(eq(events.id, guest.eventId));
    });

    return {
      url,
      filename: result.photo.originalFilename,
      expiresIn: 300,
    };
  }

  async prepareBulkDownload(guest: GuestRequestContext, photoIds: string[] | undefined, meta: RequestMeta) {
    if (!guest.settings.allowDownloads) {
      throw new ForbiddenException({
        code: 'DOWNLOADS_DISABLED',
        message: 'Downloads are disabled for this event.',
      });
    }

    const ids = photoIds?.length ? Array.from(new Set(photoIds)) : undefined;
    if (ids && ids.length > MAX_BULK_PHOTOS) {
      throw new BadRequestException(`Select up to ${MAX_BULK_PHOTOS} photographs at a time`);
    }

    const results = await this.database.db
      .select({
        photoId: photos.id,
        storageKey: photos.storageKey,
        originalFilename: photos.originalFilename,
        sizeBytes: photos.sizeBytes,
        status: photos.status,
      })
      .from(matchingResults)
      .innerJoin(photos, eq(matchingResults.photoId, photos.id))
      .where(
        and(
          eq(matchingResults.guestSessionId, guest.id),
          ids ? inArray(matchingResults.photoId, ids) : undefined,
        ),
      )
      .orderBy(asc(matchingResults.distance))
      .limit(MAX_BULK_PHOTOS + 1);

    if (results.length === 0) {
      throw new NotFoundException('No matching photographs to download');
    }
    if (results.length > MAX_BULK_PHOTOS) {
      throw new BadRequestException(
        `Your gallery has more than ${MAX_BULK_PHOTOS} matches. Select the photographs you want.`,
      );
    }
    if (ids && results.length !== ids.length) {
      throw new NotFoundException('One or more photographs are not in your private gallery');
    }

    const used = new Set<string>();
    const files = results
      .filter((result) => result.status === 'READY')
      .map((result, index) => {
        const base = sanitizeFilename(result.originalFilename || `pixme-${index + 1}.jpg`);
        let name = base;
        let counter = 1;
        while (used.has(name)) {
          const dot = base.lastIndexOf('.');
          name = dot > 0 ? `${base.slice(0, dot)}-${counter}${base.slice(dot)}` : `${base}-${counter}`;
          counter += 1;
        }
        used.add(name);
        return {
          key: result.storageKey,
          name,
          sizeBytes: result.sizeBytes,
        };
      });
    if (!files.length) {
      throw new NotFoundException('No downloadable photographs are ready yet');
    }

    const bytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    await this.database.db.transaction(async (tx) => {
      await tx.insert(downloads).values({
        eventId: guest.eventId,
        guestSessionId: guest.id,
        kind: 'BULK',
        format: 'original-zip',
        photoCount: files.length,
        bytes,
        ipHash: this.hash(meta.ip),
      });
      await tx
        .update(events)
        .set({ downloadCount: sql`${events.downloadCount} + ${files.length}` })
        .where(eq(events.id, guest.eventId));
    });

    return { files, bytes, count: files.length };
  }

  async createShareLink(guest: GuestRequestContext, photoId: string) {
    if (!guest.settings.allowGuestSharing) {
      throw new ForbiddenException({
        code: 'SHARING_DISABLED',
        message: 'Sharing is disabled for this event.',
      });
    }
    await this.assertMatch(guest.id, photoId);

    const raw = randomToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.database.db.insert(shareLinks).values({
      tokenHash: hashToken(raw, this.config.getOrThrow<string>('jwt.refreshPepper')),
      photoId,
      guestSessionId: guest.id,
      expiresAt,
    });

    return {
      url: `${this.config.getOrThrow<string>('appUrl')}/s/${raw}`,
      expiresAt,
    };
  }

  async resolveShare(token: string, meta: RequestMeta) {
    if (!token || token.length > 200) throw new NotFoundException('This share link is invalid');
    const share = await this.database.db.query.shareLinks.findFirst({
      where: eq(
        shareLinks.tokenHash,
        hashToken(token, this.config.getOrThrow<string>('jwt.refreshPepper')),
      ),
      with: {
        photo: {
          columns: {
            id: true,
            eventId: true,
            storageKey: true,
            originalFilename: true,
            sizeBytes: true,
          },
          with: {
            event: { columns: { name: true, slug: true } },
          },
        },
      },
    });
    if (!share || share.revokedAt || share.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({
        code: 'SHARE_LINK_EXPIRED',
        message: 'This share link has expired or was revoked.',
      });
    }

    const url = await this.storage.signedGetUrl(share.photo.storageKey, {
      ttlSeconds: 300,
      downloadName: share.photo.originalFilename,
    });
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(shareLinks)
        .set({ downloads: sql`${shareLinks.downloads} + 1` })
        .where(eq(shareLinks.id, share.id));
      await tx
        .update(events)
        .set({ downloadCount: sql`${events.downloadCount} + 1` })
        .where(eq(events.id, share.photo.eventId));
      await tx.insert(downloads).values({
        eventId: share.photo.eventId,
        photoId: share.photo.id,
        guestSessionId: share.guestSessionId,
        kind: 'SHARE',
        format: 'original',
        photoCount: 1,
        bytes: share.photo.sizeBytes,
        ipHash: this.hash(meta.ip),
      });
    });

    return {
      url,
      filename: share.photo.originalFilename,
      event: share.photo.event,
      expiresIn: 300,
    };
  }

  async revoke(guest: GuestRequestContext, meta: RequestMeta) {
    const session = await this.database.db.query.guestSessions.findFirst({
      where: eq(guestSessions.id, guest.id),
      columns: { selfieObjectKey: true },
      with: { event: { columns: { studioId: true } } },
    });
    if (!session) throw new NotFoundException('Guest session not found');

    if (session.selfieObjectKey) {
      await this.storage.remove(session.selfieObjectKey).catch(() => undefined);
      await this.storageUsage.removeKey(session.selfieObjectKey).catch(() => undefined);
    }

    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx.delete(matchingResults).where(eq(matchingResults.guestSessionId, guest.id));
      await tx.delete(favorites).where(eq(favorites.guestSessionId, guest.id));
      await tx
        .update(shareLinks)
        .set({ revokedAt: now })
        .where(and(eq(shareLinks.guestSessionId, guest.id), isNull(shareLinks.revokedAt)));
      await tx
        .update(guestConsents)
        .set({ withdrawnAt: now })
        .where(
          and(eq(guestConsents.guestSessionId, guest.id), isNull(guestConsents.withdrawnAt)),
        );
      await tx
        .update(guestSessions)
        .set({
          status: GuestSessionStatus.REVOKED,
          revokedAt: now,
          selfieObjectKey: null,
          selfieDeletedAt: now,
          matchCount: 0,
          errorCode: null,
        })
        .where(eq(guestSessions.id, guest.id));
    });

    await this.audit.record({
      studioId: session.event.studioId,
      action: 'GUEST_DATA_DELETED',
      entity: 'guest_session',
      entityId: guest.id,
      metadata: { eventId: guest.eventId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      message: 'Your matches, favourites, and selfie have been deleted. Your session is now closed.',
      deletedAt: now,
    };
  }

  private async assertMatch(guestSessionId: string, photoId: string) {
    const [result] = await this.database.db
      .select({
        id: matchingResults.id,
        photoId: photos.id,
        storageKey: photos.storageKey,
        originalFilename: photos.originalFilename,
        sizeBytes: photos.sizeBytes,
        status: photos.status,
      })
      .from(matchingResults)
      .innerJoin(photos, eq(matchingResults.photoId, photos.id))
      .where(
        and(
          eq(matchingResults.guestSessionId, guestSessionId),
          eq(matchingResults.photoId, photoId),
        ),
      )
      .limit(1);
    if (!result) {
      throw new NotFoundException('This photograph is not in your private gallery');
    }
    return {
      id: result.id,
      photoId: result.photoId,
      photo: {
        id: result.photoId,
        storageKey: result.storageKey,
        originalFilename: result.originalFilename,
        sizeBytes: result.sizeBytes,
        status: result.status,
      },
    };
  }

  private async signed(key: string | null, ttl = 900): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storage.signedGetUrl(key, { ttlSeconds: ttl });
    } catch {
      return null;
    }
  }
}
