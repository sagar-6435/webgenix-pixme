import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, gt, isNull, ne, sum } from 'drizzle-orm';
import {
  StudioInviteStatus,
  StudioRole,
  StorageKind,
  SubscriptionStatus,
  events,
  photos,
  storageObjects,
  studioInvites,
  studioMembers,
  studios,
  subscriptions,
  users,
} from '../db/schema';
import sharp from 'sharp';
import { DrizzleService } from '../db/drizzle.service';
import { StorageService } from '../storage/storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { hashToken, randomToken } from '../common/utils/crypto.util';
import { studioLogoKey } from '../common/utils/storage-keys';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import type {
  CreateStudioInviteDto,
  UpdateStudioDto,
  UpdateStudioMemberDto,
} from './dto/studios.dto';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class StudiosService {
  private readonly logger = new Logger(StudiosService.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly storageUsage: StorageUsageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  async current(studio: StudioContext) {
    const [row, memberCount, eventCount, photoCount, storage] = await Promise.all([
      this.database.db.query.studios.findFirst({
        where: eq(studios.id, studio.id),
        with: {
          subscription: { with: { plan: true } },
          owner: { columns: { id: true, name: true, email: true } },
        },
      }),
      this.database.db
        .select({ value: count() })
        .from(studioMembers)
        .where(eq(studioMembers.studioId, studio.id)),
      this.database.db
        .select({ value: count() })
        .from(events)
        .where(eq(events.studioId, studio.id)),
      this.database.db
        .select({ value: count() })
        .from(photos)
        .innerJoin(events, eq(photos.eventId, events.id))
        .where(eq(events.studioId, studio.id)),
      this.database.db
        .select({ value: sum(storageObjects.bytes) })
        .from(storageObjects)
        .where(and(eq(storageObjects.studioId, studio.id), isNull(storageObjects.deletedAt))),
    ]);
    if (!row) throw new NotFoundException('Studio not found');

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      brandColor: row.brandColor,
      timezone: row.timezone,
      logoUrl: await this.signed(row.logoKey),
      createdAt: row.createdAt,
      role: studio.role,
      owner: row.owner,
      storageUsedBytes: Number(storage[0]?.value ?? 0),
      counts: {
        members: Number(memberCount[0]?.value ?? 0),
        events: Number(eventCount[0]?.value ?? 0),
        photos: Number(photoCount[0]?.value ?? 0),
      },
      subscription: row.subscription
        ? {
            id: row.subscription.id,
            status: row.subscription.status,
            interval: row.subscription.interval,
            currentPeriodStart: row.subscription.currentPeriodStart,
            currentPeriodEnd: row.subscription.currentPeriodEnd,
            trialEndsAt: row.subscription.trialEndsAt,
            cancelAtPeriodEnd: row.subscription.cancelAtPeriodEnd,
            plan: {
              id: row.subscription.plan.id,
              name: row.subscription.plan.name,
              slug: row.subscription.plan.slug,
              maxEvents: row.subscription.plan.maxEvents,
              maxPhotosPerEvent: row.subscription.plan.maxPhotosPerEvent,
              maxStorageGb: row.subscription.plan.maxStorageGb,
              maxTeamMembers: row.subscription.plan.maxTeamMembers,
              features: row.subscription.plan.features,
            },
          }
        : null,
    };
  }

  async update(studio: StudioContext, dto: UpdateStudioDto, user: AuthUser, meta: RequestMeta) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Choose at least one studio setting to update');
    }
    const [updated] = await this.database.db
      .update(studios)
      .set({
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone.trim() } : {}),
        ...(dto.brandColor !== undefined ? { brandColor: dto.brandColor.toUpperCase() } : {}),
      })
      .where(eq(studios.id, studio.id))
      .returning();
    if (!updated) throw new NotFoundException('Studio not found');
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'STUDIO_UPDATED',
      entity: 'studio',
      entityId: studio.id,
      metadata: { fields: Object.keys(dto) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      brandColor: updated.brandColor,
      timezone: updated.timezone,
    };
  }

  async uploadLogo(
    studio: StudioContext,
    file: Express.Multer.File | undefined,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a logo image');
    const metadata = await sharp(file.buffer).metadata().catch(() => null);
    if (!metadata?.format || !['jpeg', 'png', 'webp', 'avif', 'tiff'].includes(metadata.format)) {
      throw new BadRequestException('Use a JPEG, PNG, WebP, or AVIF logo');
    }
    const logo = await sharp(file.buffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();

    const [existing] = await this.database.db
      .select({ logoKey: studios.logoKey })
      .from(studios)
      .where(eq(studios.id, studio.id))
      .limit(1);
    if (existing?.logoKey) {
      await this.storage.remove(existing.logoKey).catch(() => undefined);
      await this.storageUsage.removeKey(existing.logoKey).catch(() => undefined);
    }

    const key = studioLogoKey(studio.id);
    await this.storage.upload(key, logo, 'image/webp', { 'studio-id': studio.id });
    await this.storageUsage.record({
      studioId: studio.id,
      key,
      kind: StorageKind.LOGO,
      bytes: logo.byteLength,
      contentType: 'image/webp',
    });
    await this.database.db
      .update(studios)
      .set({ logoKey: key })
      .where(eq(studios.id, studio.id));
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'STUDIO_LOGO_UPDATED',
      entity: 'studio',
      entityId: studio.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { url: await this.storage.signedGetUrl(key) };
  }

  async team(studio: StudioContext) {
    const [members, invites, subscription] = await Promise.all([
      this.database.db.query.studioMembers.findMany({
        where: eq(studioMembers.studioId, studio.id),
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
              avatarKey: true,
              lastLoginAt: true,
              status: true,
            },
          },
        },
        orderBy: [asc(studioMembers.role), asc(studioMembers.createdAt)],
      }),
      this.database.db.query.studioInvites.findMany({
        where: and(
          eq(studioInvites.studioId, studio.id),
          eq(studioInvites.status, StudioInviteStatus.PENDING),
          gt(studioInvites.expiresAt, new Date()),
        ),
        orderBy: desc(studioInvites.createdAt),
        with: { invitedBy: { columns: { name: true } } },
      }),
      this.database.db.query.subscriptions.findFirst({
        where: eq(subscriptions.studioId, studio.id),
        with: { plan: true },
      }),
    ]);

    return {
      seats: {
        used: members.length,
        pending: invites.length,
        limit: subscription?.plan.maxTeamMembers ?? 1,
      },
      members: await Promise.all(
        members.map(async (member) => ({
          id: member.id,
          userId: member.user.id,
          name: member.user.name,
          email: member.user.email,
          role: member.role,
          status: member.user.status,
          lastLoginAt: member.user.lastLoginAt,
          joinedAt: member.createdAt,
          avatarUrl: await this.signed(member.user.avatarKey),
        })),
      ),
      invites: invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        invitedBy: invite.invitedBy?.name ?? null,
      })),
    };
  }

  async invite(
    studio: StudioContext,
    dto: CreateStudioInviteDto,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const email = dto.email.trim().toLowerCase();
    if (dto.role === StudioRole.OWNER) {
      throw new BadRequestException('Ownership cannot be transferred through an invite');
    }

    const [existingMember, subscription, memberCount, pendingCount] = await Promise.all([
      this.database.db
        .select({ id: studioMembers.id })
        .from(studioMembers)
        .innerJoin(users, eq(studioMembers.userId, users.id))
        .where(and(eq(studioMembers.studioId, studio.id), eq(users.email, email)))
        .limit(1),
      this.database.db.query.subscriptions.findFirst({
        where: eq(subscriptions.studioId, studio.id),
        with: { plan: true },
      }),
      this.database.db
        .select({ value: count() })
        .from(studioMembers)
        .where(eq(studioMembers.studioId, studio.id)),
      this.database.db
        .select({ value: count() })
        .from(studioInvites)
        .where(
          and(
            eq(studioInvites.studioId, studio.id),
            eq(studioInvites.status, StudioInviteStatus.PENDING),
            gt(studioInvites.expiresAt, new Date()),
            ne(studioInvites.email, email),
          ),
        ),
    ]);
    if (existingMember) {
      throw new ConflictException('That person is already on your team');
    }
    if (!subscription) {
      throw new ForbiddenException({
        code: 'NO_SUBSCRIPTION',
        message: 'Your studio does not have a subscription plan.',
      });
    }
    const members = Number(memberCount[0]?.value ?? 0);
    const pending = Number(pendingCount[0]?.value ?? 0);
    if (
      subscription.status === SubscriptionStatus.CANCELED ||
      subscription.status === SubscriptionStatus.EXPIRED
    ) {
      throw new ForbiddenException('Your subscription is inactive. Reactivate it to invite teammates.');
    }
    if (members + pending >= subscription.plan.maxTeamMembers) {
      throw new ForbiddenException({
        code: 'TEAM_LIMIT_REACHED',
        message: `Your ${subscription.plan.name} plan includes ${subscription.plan.maxTeamMembers} seat${subscription.plan.maxTeamMembers === 1 ? '' : 's'}. Upgrade to invite more teammates.`,
      });
    }

    const rawToken = randomToken(32);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const tokenHash = hashToken(rawToken, this.config.getOrThrow<string>('jwt.refreshPepper'));

    const [invite] = await this.database.db
      .insert(studioInvites)
      .values({
        studioId: studio.id,
        email,
        role: dto.role,
        tokenHash,
        invitedById: user.id,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [studioInvites.studioId, studioInvites.email],
        set: {
          role: dto.role,
          tokenHash,
          invitedById: user.id,
          expiresAt,
          status: StudioInviteStatus.PENDING,
          acceptedAt: null,
        },
      })
      .returning();

    await this.mail.sendStudioInvite(email, studio.name, user.name, rawToken);
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'STUDIO_INVITE_SENT',
      entity: 'studio_invite',
      entityId: invite.id,
      metadata: { email, role: dto.role },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.notifications
      .create({
        studioId: studio.id,
        userId: user.id,
        type: 'SYSTEM',
        title: 'Invitation sent',
        body: `${email} was invited to join ${studio.name}.`,
        data: { inviteId: invite.id, email },
      })
      .catch(() => undefined);

    return {
      id: invite.id,
      email,
      role: invite.role,
      expiresAt,
      ...(this.config.get<boolean>('exposeDevTokens') ? { devInviteToken: rawToken } : {}),
    };
  }

  async revokeInvite(
    studio: StudioContext,
    inviteId: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const invite = await this.database.db.query.studioInvites.findFirst({
      where: and(eq(studioInvites.id, inviteId), eq(studioInvites.studioId, studio.id)),
    });
    if (!invite) throw new NotFoundException('Invitation not found');
    await this.database.db
      .update(studioInvites)
      .set({ status: StudioInviteStatus.REVOKED })
      .where(eq(studioInvites.id, inviteId));
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'STUDIO_INVITE_REVOKED',
      entity: 'studio_invite',
      entityId: inviteId,
      metadata: { email: invite.email },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { message: 'Invitation revoked' };
  }

  async acceptInvite(user: AuthUser, rawToken: string, meta: RequestMeta) {
    const invite = await this.database.db.query.studioInvites.findFirst({
      where: (invites, operators) =>
        operators.eq(
          invites.tokenHash,
          hashToken(rawToken, this.config.getOrThrow<string>('jwt.refreshPepper')),
        ),
    });
    if (!invite || invite.status !== StudioInviteStatus.PENDING) {
      throw new NotFoundException('This invitation is no longer valid');
    }
    const studio = await this.database.db.query.studios.findFirst({
      where: (studios, operators) => operators.eq(studios.id, invite.studioId),
      with: { subscription: { with: { plan: true } } },
    });
    if (!studio) throw new NotFoundException('Studio not found');
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation has expired. Ask the studio owner to resend it.');
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }
    if (!studio.subscription) {
      throw new ForbiddenException('The studio plan is not active');
    }
    const [memberCount] = await this.database.db
      .select({ value: count() })
      .from(studioMembers)
      .where(eq(studioMembers.studioId, invite.studioId));
    if (Number(memberCount?.value ?? 0) >= studio.subscription.plan.maxTeamMembers) {
      throw new ForbiddenException('The studio has no available seats. Ask the owner to upgrade.');
    }

    const [existing] = await this.database.db
      .select()
      .from(studioMembers)
      .where(
        and(
          eq(studioMembers.studioId, invite.studioId),
          eq(studioMembers.userId, user.id),
        ),
      )
      .limit(1);

    const member = await this.database.db.transaction(async (tx) => {
      let created = existing;
      if (!created) {
        [created] = await tx
          .insert(studioMembers)
          .values({
            studioId: invite.studioId,
            userId: user.id,
            role: invite.role,
          })
          .returning();
      }
      await tx
        .update(studioInvites)
        .set({ status: StudioInviteStatus.ACCEPTED, acceptedAt: new Date() })
        .where(eq(studioInvites.id, invite.id));
      return created;
    });

    await this.audit.record({
      studioId: invite.studioId,
      actorId: user.id,
      action: 'STUDIO_INVITE_ACCEPTED',
      entity: 'studio_member',
      entityId: member.id,
      metadata: { inviteId: invite.id, role: invite.role },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.notifications.create({
      studioId: invite.studioId,
      type: 'SYSTEM',
      title: 'New team member',
      body: `${user.name} joined ${studio.name}.`,
      data: { userId: user.id, role: invite.role },
    });

    return {
      studio: {
        id: studio.id,
        name: studio.name,
        slug: studio.slug,
        role: member.role,
      },
      message: `You're now part of ${studio.name}`,
    };
  }

  async updateMember(
    studio: StudioContext,
    memberId: string,
    dto: UpdateStudioMemberDto,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    if (dto.role === StudioRole.OWNER) {
      throw new BadRequestException('Ownership can only be changed by transferring the studio');
    }
    const member = await this.database.db.query.studioMembers.findFirst({
      where: and(eq(studioMembers.id, memberId), eq(studioMembers.studioId, studio.id)),
      with: { user: { columns: { name: true, email: true } } },
    });
    if (!member) throw new NotFoundException('Team member not found');
    if (member.role === StudioRole.OWNER) {
      throw new ForbiddenException('The studio owner role cannot be changed');
    }
    if (studio.role === StudioRole.ADMIN && member.role === StudioRole.ADMIN) {
      throw new ForbiddenException('Only the owner can change another admin');
    }

    const [updated] = await this.database.db
      .update(studioMembers)
      .set({ role: dto.role })
      .where(eq(studioMembers.id, memberId))
      .returning();
    if (!updated) throw new NotFoundException('Team member not found');
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'STUDIO_MEMBER_ROLE_CHANGED',
      entity: 'studio_member',
      entityId: memberId,
      metadata: { email: member.user.email, from: member.role, to: dto.role },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { id: updated.id, role: updated.role };
  }

  async removeMember(
    studio: StudioContext,
    memberId: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const member = await this.database.db.query.studioMembers.findFirst({
      where: and(eq(studioMembers.id, memberId), eq(studioMembers.studioId, studio.id)),
      with: { user: { columns: { id: true, name: true, email: true } } },
    });
    if (!member) throw new NotFoundException('Team member not found');
    if (member.role === StudioRole.OWNER) {
      throw new ForbiddenException('The studio owner cannot be removed');
    }
    if (member.userId === user.id && studio.role !== StudioRole.OWNER) {
      // Leaving is allowed, but not through the admin removal endpoint.
      throw new ForbiddenException('Ask the owner to remove you from the studio');
    }

    await this.database.db.delete(studioMembers).where(eq(studioMembers.id, memberId));
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'STUDIO_MEMBER_REMOVED',
      entity: 'studio_member',
      entityId: memberId,
      metadata: { email: member.user.email },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.notifications
      .create({
        studioId: studio.id,
        userId: user.id,
        type: 'SYSTEM',
        title: 'Team member removed',
        body: `${member.user.name} no longer has access to ${studio.name}.`,
        data: { memberId },
      })
      .catch(() => undefined);
    return { message: 'Team member removed' };
  }

  async usage(studio: StudioContext) {
    const [summary, subscription, eventCount, photoCount] = await Promise.all([
      this.storageUsage.summary(studio.id),
      this.database.db.query.subscriptions.findFirst({
        where: eq(subscriptions.studioId, studio.id),
        with: { plan: true },
      }),
      this.database.db
        .select({ value: count() })
        .from(events)
        .where(eq(events.studioId, studio.id)),
      this.database.db
        .select({ value: count() })
        .from(photos)
        .innerJoin(events, eq(photos.eventId, events.id))
        .where(eq(events.studioId, studio.id)),
    ]);
    const used = summary.reduce((total, item) => total + item.bytes, 0);
    const limit = (subscription?.plan.maxStorageGb ?? 0) * 1024 * 1024 * 1024;
    return {
      storage: {
        usedBytes: used,
        limitBytes: limit,
        percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 10000) / 100) : 0,
        byKind: summary,
      },
      counts: {
        events: Number(eventCount[0]?.value ?? 0),
        photos: Number(photoCount[0]?.value ?? 0),
        eventsLimit: subscription?.plan.maxEvents ?? 0,
        photosPerEventLimit: subscription?.plan.maxPhotosPerEvent ?? 0,
      },
    };
  }

  private async signed(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storage.signedGetUrl(key, { ttlSeconds: 3600 });
    } catch {
      return null;
    }
  }
}
