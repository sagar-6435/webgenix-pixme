import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, sum } from 'drizzle-orm';
import {
  EventCategory,
  EventStatus,
  GuestSessionStatus,
  PlanInterval,
  SubscriptionStatus,
  eventSettings,
  events,
  favorites,
  guestConsents,
  guestSessions,
  matchingResults,
  photos,
  qrCodes,
  qrScans,
  storageObjects,
  subscriptions,
} from '../db/schema';
import { DrizzleService } from '../db/drizzle.service';
import { StorageService } from '../storage/storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { ProcessingService } from '../processing/processing.service';
import sharp from 'sharp';
import { isUniqueViolation } from '../common/utils/db-errors';
import {
  hashToken,
  todayKey,
  uniqueSlug,
} from '../common/utils/crypto.util';
import { paginate } from '../common/utils/pagination.util';
import {
  eventCoverKey,
  eventLogoKey,
} from '../common/utils/storage-keys';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import type {
  CreateEventDto,
  EventListQueryDto,
  GuestSessionListQueryDto,
  UpdateEventDto,
} from './dto/events.dto';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly storageUsage: StorageUsageService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly processing: ProcessingService,
  ) {}

  private async ensurePlanAllowsNewEvent(studioId: string): Promise<void> {
    const subscription = await this.database.db.query.subscriptions.findFirst({
      where: eq(subscriptions.studioId, studioId),
      with: { plan: true },
    });
    if (!subscription) {
      throw new ForbiddenException({
        code: 'NO_SUBSCRIPTION',
        message: 'This studio does not have an active plan.',
      });
    }
    if (
      subscription.status === SubscriptionStatus.CANCELED ||
      subscription.status === SubscriptionStatus.EXPIRED
    ) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_INACTIVE',
        message: 'Your subscription is inactive. Choose a plan to create more events.',
      });
    }
    const [row] = await this.database.db
      .select({ value: count() })
      .from(events)
      .where(and(eq(events.studioId, studioId), ne(events.status, EventStatus.ARCHIVED)));
    if (Number(row?.value ?? 0) >= subscription.plan.maxEvents) {
      throw new ForbiddenException({
        code: 'EVENT_LIMIT_REACHED',
        message: `Your ${subscription.plan.name} plan allows ${subscription.plan.maxEvents} events. Upgrade to create more.`,
      });
    }
  }

  private parseDate(value: string | undefined, field: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return date;
  }

  private validateDates(startAt: Date, endAt?: Date | null, galleryExpiresAt?: Date | null): void {
    if (endAt && endAt.getTime() < startAt.getTime()) {
      throw new BadRequestException('The event end date must be after the start date');
    }
    if (galleryExpiresAt && galleryExpiresAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException('The gallery expiry must be after the event starts');
    }
  }

  async create(studio: StudioContext, user: AuthUser, dto: CreateEventDto, meta: RequestMeta) {
    await this.ensurePlanAllowsNewEvent(studio.id);
    const startAt = this.parseDate(dto.startAt, 'startAt')!;
    const endAt = this.parseDate(dto.endAt, 'endAt');
    const galleryExpiresAt =
      this.parseDate(dto.galleryExpiresAt, 'galleryExpiresAt') ??
      new Date(startAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    this.validateDates(startAt, endAt, galleryExpiresAt);

    let createdId: string | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3 && !createdId; attempt += 1) {
      const slug = uniqueSlug(dto.name);
      try {
        const event = await this.database.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(events)
            .values({
              studioId: studio.id,
              createdById: user.id,
              name: dto.name.trim(),
              slug,
              category: dto.category,
              description: dto.description?.trim() ?? '',
              status: dto.status ?? EventStatus.PUBLISHED,
              startAt,
              endAt: endAt ?? null,
              galleryExpiresAt,
              locationName: dto.locationName?.trim() ?? '',
              locationAddress: dto.locationAddress?.trim() ?? '',
              city: dto.city?.trim() ?? '',
              country: dto.country?.trim() ?? '',
              brandColor: dto.brandColor ?? '#FF5A36',
              isDiscoverable: dto.isDiscoverable ?? true,
            })
            .returning();

          await tx.insert(eventSettings).values({
            eventId: created.id,
            matchThreshold: dto.settings?.matchThreshold ?? 0.52,
            minFaceConfidence: dto.settings?.minFaceConfidence ?? 0.65,
            maxPhotosPerMatch: dto.settings?.maxPhotosPerMatch ?? 500,
            guestSessionMinutes: dto.settings?.guestSessionMinutes ?? 120,
            selfieRetentionMinutes: dto.settings?.selfieRetentionMinutes ?? 15,
            allowDownloads: dto.settings?.allowDownloads ?? true,
            allowFavorites: dto.settings?.allowFavorites ?? true,
            allowGuestSharing: dto.settings?.allowGuestSharing ?? false,
            watermarkDownloads: dto.settings?.watermarkDownloads ?? false,
            consentVersion: dto.settings?.consentVersion ?? '2026-01',
            consentText: dto.settings?.consentText ?? null,
          });
          await tx.insert(qrCodes).values({
            eventId: created.id,
            targetPath: `/e/${slug}?src=qr`,
          });
          return created;
        });
        createdId = event.id;
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 2) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    if (!createdId) {
      this.logger.error('Could not generate a unique event slug', lastError);
      throw new BadRequestException('Could not create a unique event link. Try a different name.');
    }

    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'EVENT_CREATED',
      entity: 'event',
      entityId: createdId,
      metadata: { name: dto.name, category: dto.category },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.get(studio.id, createdId);
  }

  async list(studioId: string, query: EventListQueryDto) {
    const conditions = [eq(events.studioId, studioId)];
    conditions.push(
      query.status ? eq(events.status, query.status) : ne(events.status, EventStatus.ARCHIVED),
    );
    if (query.category) conditions.push(eq(events.category, query.category));
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(
          ilike(events.name, pattern),
          ilike(events.locationName, pattern),
          ilike(events.city, pattern),
        )!,
      );
    }

    const orderBy =
      query.sort === 'oldest' || query.sort === 'upcoming'
        ? asc(events.startAt)
        : desc(events.startAt);
    const where = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.database.db
        .select({ event: events, qrScans: qrCodes.scans })
        .from(events)
        .leftJoin(qrCodes, eq(qrCodes.eventId, events.id))
        .where(where)
        .orderBy(orderBy)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.database.db.select({ value: count() }).from(events).where(where),
    ]);

    const data = await Promise.all(
      rows.map(async ({ event, qrScans: scans }) => ({
        id: event.id,
        name: event.name,
        slug: event.slug,
        category: event.category,
        status: event.status,
        startAt: event.startAt,
        endAt: event.endAt,
        locationName: event.locationName,
        city: event.city,
        country: event.country,
        brandColor: event.brandColor,
        galleryExpiresAt: event.galleryExpiresAt,
        coverUrl: await this.signed(event.coverImageKey),
        photoCount: event.photoCount,
        faceCount: event.faceCount,
        guestCount: event.guestCount,
        downloadCount: event.downloadCount,
        qrScans: scans ?? 0,
        createdAt: event.createdAt,
      })),
    );

    return paginate(data, Number(totalRows[0]?.value ?? 0), query.page, query.limit);
  }

  async get(studioId: string, eventId: string) {
    const event = await this.database.db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.studioId, studioId)),
      with: {
        settings: true,
        qrCode: true,
        studio: {
          columns: { id: true, name: true, slug: true, brandColor: true, logoKey: true },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const [processingRows, storageRows, subscriberRows] = await Promise.all([
      this.database.db
        .select({ status: photos.status, value: count() })
        .from(photos)
        .where(eq(photos.eventId, eventId))
        .groupBy(photos.status),
      this.database.db
        .select({ value: sum(storageObjects.bytes) })
        .from(storageObjects)
        .where(and(eq(storageObjects.eventId, eventId), isNull(storageObjects.deletedAt))),
      this.database.db
        .select({ value: count() })
        .from(guestSessions)
        .where(
          and(
            eq(guestSessions.eventId, eventId),
            inArray(guestSessions.status, [
              GuestSessionStatus.MATCHED,
              GuestSessionStatus.NO_MATCHES,
            ]),
          ),
        ),
    ]);

    const processingCounts = processingRows.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = Number(item.value);
      return acc;
    }, {});

    return {
      id: event.id,
      name: event.name,
      slug: event.slug,
      category: event.category,
      description: event.description,
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
      galleryExpiresAt: event.galleryExpiresAt,
      location: {
        name: event.locationName,
        address: event.locationAddress,
        city: event.city,
        country: event.country,
      },
      brandColor: event.brandColor,
      isDiscoverable: event.isDiscoverable,
      coverUrl: await this.signed(event.coverImageKey),
      logoUrl: await this.signed(event.logoKey),
      settings: event.settings,
      qr: event.qrCode
        ? {
            targetPath: event.qrCode.targetPath,
            publicUrl: `${this.config.getOrThrow<string>('appUrl')}/e/${event.slug}`,
            scans: event.qrCode.scans,
            lastScanAt: event.qrCode.lastScanAt,
          }
        : null,
      counts: {
        photos: event.photoCount,
        faces: event.faceCount,
        guests: event.guestCount,
        downloads: event.downloadCount,
        matchedGuests: Number(subscriberRows[0]?.value ?? 0),
        storageBytes: Number(storageRows[0]?.value ?? 0),
        processing: {
          queued: processingCounts.QUEUED ?? 0,
          processing: processingCounts.PROCESSING ?? 0,
          ready: processingCounts.READY ?? 0,
          failed: processingCounts.FAILED ?? 0,
        },
      },
      studio: {
        ...event.studio,
        logoUrl: await this.signed(event.studio.logoKey),
      },
      createdAt: event.createdAt,
    };
  }

  async update(
    studioId: string,
    eventId: string,
    dto: UpdateEventDto,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const existing = await this.database.db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.studioId, studioId)),
      with: { settings: true },
    });
    if (!existing) throw new NotFoundException('Event not found');

    const startAt = this.parseDate(dto.startAt, 'startAt') ?? existing.startAt;
    const endAt =
      dto.endAt === undefined ? existing.endAt : dto.endAt === null ? null : this.parseDate(dto.endAt, 'endAt');
    const galleryExpiresAt =
      dto.galleryExpiresAt === undefined
        ? existing.galleryExpiresAt
        : dto.galleryExpiresAt === null
          ? null
          : this.parseDate(dto.galleryExpiresAt, 'galleryExpiresAt');
    this.validateDates(startAt, endAt, galleryExpiresAt);

    const settingsData = dto.settings
      ? (Object.fromEntries(
          Object.entries(dto.settings).filter(([, value]) => value !== undefined),
        ) as Partial<typeof eventSettings.$inferInsert>)
      : undefined;

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.startAt !== undefined ? { startAt } : {}),
          ...(dto.endAt !== undefined ? { endAt } : {}),
          ...(dto.galleryExpiresAt !== undefined ? { galleryExpiresAt } : {}),
          ...(dto.locationName !== undefined ? { locationName: dto.locationName } : {}),
          ...(dto.locationAddress !== undefined ? { locationAddress: dto.locationAddress } : {}),
          ...(dto.city !== undefined ? { city: dto.city } : {}),
          ...(dto.country !== undefined ? { country: dto.country } : {}),
          ...(dto.brandColor !== undefined ? { brandColor: dto.brandColor } : {}),
          ...(dto.isDiscoverable !== undefined ? { isDiscoverable: dto.isDiscoverable } : {}),
        })
        .where(eq(events.id, eventId));
      if (settingsData && Object.keys(settingsData).length) {
        await tx
          .update(eventSettings)
          .set(settingsData)
          .where(eq(eventSettings.eventId, eventId));
      }
    });

    await this.audit.record({
      studioId,
      actorId: user.id,
      action: 'EVENT_UPDATED',
      entity: 'event',
      entityId: eventId,
      metadata: { fields: Object.keys(dto) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.realtime.emitToStudio(studioId, 'event.updated', { eventId });
    return this.get(studioId, eventId);
  }

  async remove(studioId: string, eventId: string, user: AuthUser, meta: RequestMeta) {
    const [event] = await this.database.db
      .select({ id: events.id, name: events.name, status: events.status })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.studioId, studioId)))
      .limit(1);
    if (!event) throw new NotFoundException('Event not found');
    if (event.status === EventStatus.ARCHIVED) {
      return { message: 'This event is already being deleted', eventId };
    }

    await this.processing.enqueueDeleteEvent(eventId, studioId);
    await this.database.db
      .update(events)
      .set({ status: EventStatus.ARCHIVED })
      .where(eq(events.id, eventId));
    await this.audit.record({
      studioId,
      actorId: user.id,
      action: 'EVENT_DELETION_QUEUED',
      entity: 'event',
      entityId: eventId,
      metadata: { name: event.name },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.realtime.emitToStudio(studioId, 'event.updated', { eventId, status: 'ARCHIVED' });
    return { message: 'Event deletion has been queued', eventId };
  }

  async setStatus(
    studioId: string,
    eventId: string,
    status: EventStatus,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const [event] = await this.database.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.studioId, studioId)))
      .limit(1);
    if (!event) throw new NotFoundException('Event not found');
    if (status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Use the delete action to archive an event');
    }
    await this.database.db.update(events).set({ status }).where(eq(events.id, eventId));
    await this.audit.record({
      studioId,
      actorId: user.id,
      action: status === EventStatus.PUBLISHED ? 'EVENT_PUBLISHED' : 'EVENT_UNPUBLISHED',
      entity: 'event',
      entityId: eventId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.realtime.emitToStudio(studioId, 'event.updated', { eventId, status });
    return { id: eventId, status };
  }

  async uploadCover(
    studioId: string,
    eventId: string,
    file: Express.Multer.File | undefined,
    type: 'cover' | 'logo',
    user: AuthUser,
    meta: RequestMeta,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image to upload');
    const [event] = await this.database.db
      .select({ id: events.id, coverImageKey: events.coverImageKey, logoKey: events.logoKey })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.studioId, studioId)))
      .limit(1);
    if (!event) throw new NotFoundException('Event not found');

    let buffer: Buffer;
    try {
      const image = sharp(file.buffer).rotate();
      buffer =
        type === 'cover'
          ? await image
              .resize({ width: 2400, height: 1600, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 86 })
              .toBuffer()
          : await image
              .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 90, alphaQuality: 100 })
              .toBuffer();
    } catch {
      throw new BadRequestException('The file must be a valid JPEG, PNG, WebP, AVIF, or TIFF image');
    }

    const key =
      type === 'cover' ? eventCoverKey(studioId, eventId) : eventLogoKey(studioId, eventId);
    await this.storage.upload(key, buffer, 'image/webp');
    await this.storageUsage.record({
      studioId,
      eventId,
      key,
      kind: type === 'cover' ? 'COVER' : 'LOGO',
      bytes: buffer.byteLength,
      contentType: 'image/webp',
    });

    const previous = type === 'cover' ? event.coverImageKey : event.logoKey;
    await this.database.db
      .update(events)
      .set(type === 'cover' ? { coverImageKey: key } : { logoKey: key })
      .where(eq(events.id, eventId));
    if (previous) {
      await this.storage.remove(previous).catch(() => undefined);
      await this.storageUsage.removeKey(previous).catch(() => undefined);
    }
    await this.audit.record({
      studioId,
      actorId: user.id,
      action: type === 'cover' ? 'EVENT_COVER_UPDATED' : 'EVENT_LOGO_UPDATED',
      entity: 'event',
      entityId: eventId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.realtime.emitToStudio(studioId, 'event.updated', { eventId });
    return { url: await this.storage.signedGetUrl(key) };
  }

  async publicBySlug(
    slug: string,
    options: { src?: string; ip?: string; userAgent?: string; referrer?: string },
  ) {
    const event = await this.database.db.query.events.findFirst({
      where: and(eq(events.slug, slug), eq(events.status, EventStatus.PUBLISHED)),
      with: {
        settings: true,
        qrCode: true,
        studio: { columns: { name: true, slug: true, logoKey: true, brandColor: true } },
      },
    });
    if (!event) throw new NotFoundException('This event could not be found');

    if (options.src === 'qr' && event.qrCode) {
      await this.recordQrScan(event.qrCode.id, event.id, options);
    }

    const expired = Boolean(
      event.galleryExpiresAt && event.galleryExpiresAt.getTime() < Date.now(),
    );

    return {
      id: event.id,
      name: event.name,
      slug: event.slug,
      category: event.category,
      description: event.description,
      startAt: event.startAt,
      endAt: event.endAt,
      location: {
        name: event.locationName,
        address: event.locationAddress,
        city: event.city,
        country: event.country,
      },
      brandColor: event.brandColor,
      coverUrl: await this.signed(event.coverImageKey),
      logoUrl: await this.signed(event.logoKey),
      isDiscoverable: event.isDiscoverable,
      expired,
      galleryExpiresAt: event.galleryExpiresAt,
      photoCount: expired ? 0 : event.photoCount,
      studio: {
        name: event.studio.name,
        slug: event.studio.slug,
        brandColor: event.studio.brandColor,
        logoUrl: await this.signed(event.studio.logoKey),
      },
      consent: {
        version: event.settings?.consentVersion ?? '2026-01',
        customText: event.settings?.consentText ?? null,
        selfieRetentionMinutes: event.settings?.selfieRetentionMinutes ?? 15,
        guestSessionMinutes: event.settings?.guestSessionMinutes ?? 120,
      },
      permissions: {
        allowDownloads: expired ? false : (event.settings?.allowDownloads ?? true),
        allowFavorites: expired ? false : (event.settings?.allowFavorites ?? true),
        allowGuestSharing: expired ? false : (event.settings?.allowGuestSharing ?? false),
      },
    };
  }

  private async recordQrScan(
    qrCodeId: string,
    eventId: string,
    options: { ip?: string; userAgent?: string; referrer?: string },
  ): Promise<void> {
    const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
    const ipHash = options.ip ? hashToken(options.ip, pepper) : null;
    const dedupeKey = hashToken(`${qrCodeId}:${ipHash ?? 'unknown'}:${todayKey()}`, pepper);
    try {
      await this.database.db.transaction(async (tx) => {
        await tx.insert(qrScans).values({
          qrCodeId,
          eventId,
          dedupeKey,
          ipHash,
          userAgent: options.userAgent?.slice(0, 300) ?? null,
          referrer: options.referrer?.slice(0, 500) ?? null,
        });
        await tx
          .update(qrCodes)
          .set({ scans: sql`${qrCodes.scans} + 1`, lastScanAt: new Date() })
          .where(eq(qrCodes.id, qrCodeId));
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return;
      }
      throw error;
    }
  }

  async listGuestSessions(studioId: string, eventId: string, query: GuestSessionListQueryDto) {
    await this.assertEvent(studioId, eventId);
    const conditions = [eq(guestSessions.eventId, eventId)];
    if (query.status) {
      conditions.push(eq(guestSessions.status, query.status as GuestSessionStatus));
    }
    const where = and(...conditions);

    const [sessions, totalRows, grouped] = await Promise.all([
      this.database.db
        .select({
          id: guestSessions.id,
          status: guestSessions.status,
          consentAt: guestSessions.consentAt,
          expiresAt: guestSessions.expiresAt,
          lastSelfieAt: guestSessions.lastSelfieAt,
          matchingCompletedAt: guestSessions.matchingCompletedAt,
          matchCount: guestSessions.matchCount,
          errorCode: guestSessions.errorCode,
          createdAt: guestSessions.createdAt,
          selfieDeletedAt: guestSessions.selfieDeletedAt,
        })
        .from(guestSessions)
        .where(where)
        .orderBy(desc(guestSessions.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.database.db
        .select({ value: count() })
        .from(guestSessions)
        .where(where),
      this.database.db
        .select({ status: guestSessions.status, value: count() })
        .from(guestSessions)
        .where(eq(guestSessions.eventId, eventId))
        .groupBy(guestSessions.status),
    ]);
    return {
      ...paginate(sessions, Number(totalRows[0]?.value ?? 0), query.page, query.limit),
      summary: grouped.map((group) => ({ status: group.status, count: Number(group.value) })),
    };
  }

  async deleteGuestSession(
    studioId: string,
    eventId: string,
    sessionId: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    await this.assertEvent(studioId, eventId);
    const [session] = await this.database.db
      .select()
      .from(guestSessions)
      .where(and(eq(guestSessions.id, sessionId), eq(guestSessions.eventId, eventId)))
      .limit(1);
    if (!session) throw new NotFoundException('Guest session not found');
    if (session.selfieObjectKey) {
      await this.storage.remove(session.selfieObjectKey).catch(() => undefined);
      await this.storageUsage.removeKey(session.selfieObjectKey).catch(() => undefined);
    }
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx.delete(matchingResults).where(eq(matchingResults.guestSessionId, sessionId));
      await tx.delete(favorites).where(eq(favorites.guestSessionId, sessionId));
      await tx
        .update(guestSessions)
        .set({
          status: GuestSessionStatus.REVOKED,
          revokedAt: now,
          selfieObjectKey: null,
          selfieDeletedAt: now,
          matchCount: 0,
        })
        .where(eq(guestSessions.id, sessionId));
      await tx
        .update(guestConsents)
        .set({ withdrawnAt: now })
        .where(eq(guestConsents.guestSessionId, sessionId));
    });
    await this.audit.record({
      studioId,
      actorId: user.id,
      action: 'GUEST_BIOMETRIC_DATA_DELETED',
      entity: 'guest_session',
      entityId: sessionId,
      metadata: { eventId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.realtime.emitToGuest(sessionId, 'guest.session.revoked', {
      message: 'The event organiser removed this guest session.',
    });
    return { message: 'Guest session data deleted' };
  }

  async analytics(studioId: string, eventId: string, days = 30) {
    const event = await this.database.db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.studioId, studioId)),
      columns: {
        id: true,
        name: true,
        slug: true,
        photoCount: true,
        faceCount: true,
        guestCount: true,
        downloadCount: true,
      },
      with: { qrCode: { columns: { scans: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');

    const range = Math.max(7, Math.min(365, days));
    const since = new Date(Date.now() - (range - 1) * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const daily = (table: 'guest_sessions' | 'matching_results' | 'downloads' | 'qr_scans') =>
      sql`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
        FROM ${sql.identifier(table)} WHERE "eventId" = ${eventId} AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1
      `;

    const [sessionsResult, matchesResult, downloadsResult, scansResult, matchedRows, failedRows, matchRows] =
      await Promise.all([
        this.database.db.execute(daily('guest_sessions')),
        this.database.db.execute(daily('matching_results')),
        this.database.db.execute(daily('downloads')),
        this.database.db.execute(daily('qr_scans')),
        this.database.db
          .select({ value: count() })
          .from(guestSessions)
          .where(
            and(eq(guestSessions.eventId, eventId), eq(guestSessions.status, GuestSessionStatus.MATCHED)),
          ),
        this.database.db
          .select({ value: count() })
          .from(guestSessions)
          .where(
            and(eq(guestSessions.eventId, eventId), eq(guestSessions.status, GuestSessionStatus.FAILED)),
          ),
        this.database.db
          .select({ value: count() })
          .from(matchingResults)
          .where(eq(matchingResults.eventId, eventId)),
      ]);

    const rowsOf = (result: { rows: unknown[] }) =>
      result.rows as { day: string; count: string | number }[];
    const byDay = (rows: { day: string; count: string | number }[]) =>
      new Map(rows.map((row) => [row.day, Number(row.count)]));
    const maps = {
      sessions: byDay(rowsOf(sessionsResult)),
      matches: byDay(rowsOf(matchesResult)),
      downloads: byDay(rowsOf(downloadsResult)),
      scans: byDay(rowsOf(scansResult)),
    };

    const series = Array.from({ length: range }, (_, index) => {
      const date = new Date(since.getTime() + index * 24 * 60 * 60 * 1000);
      const day = date.toISOString().slice(0, 10);
      return {
        day,
        sessions: maps.sessions.get(day) ?? 0,
        matches: maps.matches.get(day) ?? 0,
        downloads: maps.downloads.get(day) ?? 0,
        scans: maps.scans.get(day) ?? 0,
      };
    });

    const totalSessions = event.guestCount;
    const matchedSessions = Number(matchedRows[0]?.value ?? 0);
    return {
      event: { id: event.id, name: event.name, slug: event.slug },
      totals: {
        photos: event.photoCount,
        faces: event.faceCount,
        guestSessions: totalSessions,
        matchedSessions,
        failedSessions: Number(failedRows[0]?.value ?? 0),
        matchResults: Number(matchRows[0]?.value ?? 0),
        downloads: event.downloadCount,
        qrScans: event.qrCode?.scans ?? 0,
        conversionRate:
          totalSessions > 0 ? Math.round((matchedSessions / totalSessions) * 1000) / 10 : 0,
      },
      series,
    };
  }

  private async assertEvent(studioId: string, eventId: string): Promise<void> {
    const [exists] = await this.database.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.studioId, studioId)))
      .limit(1);
    if (!exists) throw new NotFoundException('Event not found');
  }

  private async signed(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storage.signedGetUrl(key, { ttlSeconds: 3600 });
    } catch {
      return null;
    }
  }

  static categoryLabel(category: EventCategory): string {
    return category
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  static planIntervalLabel(interval: PlanInterval): string {
    return interval === PlanInterval.YEARLY ? 'year' : 'month';
  }
}
