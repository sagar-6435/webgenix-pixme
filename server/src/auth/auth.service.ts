import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, asc, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import {
  PlanInterval,
  SubscriptionStatus,
  UserRole,
  UserStatus,
  VerificationTokenType,
  plans,
  studioMembers,
  studios,
  subscriptions,
  userSessions,
  users,
  verificationTokens,
} from '../db/schema';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { DrizzleService } from '../db/drizzle.service';
import {
  hashToken,
  randomToken,
  uniqueSlug,
} from '../common/utils/crypto.util';
import type { AuthUser } from '../common/types/auth.types';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_TOKEN_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private accessTtlSeconds(): number {
    const raw = this.config.get<string>('jwt.accessTtl') ?? '15m';
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2];
    return value * { s: 1, m: 60, h: 3600, d: 86400 }[unit as 's' | 'm' | 'h' | 'd'];
  }

  private async signAccessToken(user: {
    id: string;
    role: UserRole;
  }, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, typ: 'access', role: user.role, sid: sessionId },
      {
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: this.accessTtlSeconds(),
      },
    );
  }

  private async issueSession(
    user: { id: string; role: UserRole },
    meta: RequestMeta,
    familyId?: string,
  ) {
    const rawRefresh = randomToken(48);
    const refreshPepper = this.config.getOrThrow<string>('jwt.refreshPepper');
    const refreshTtlDays = this.config.get<number>('jwt.refreshTtlDays') ?? 30;
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    const [session] = await this.database.db
      .insert(userSessions)
      .values({
        userId: user.id,
        refreshTokenHash: hashToken(rawRefresh, refreshPepper),
        familyId: familyId ?? randomUUID(),
        expiresAt,
        ipHash: meta.ip ? hashToken(meta.ip, refreshPepper) : null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        lastUsedAt: new Date(),
      })
      .returning();

    const accessToken = await this.signAccessToken(user, session.id);
    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: this.accessTtlSeconds(),
      sessionId: session.id,
      refreshExpiresAt: expiresAt,
    };
  }

  private async serializeUser(userId: string) {
    const user = await this.database.db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        memberships: {
          orderBy: (membership, { asc: ascending }) => [ascending(membership.createdAt)],
          with: {
            studio: {
              with: {
                subscription: { with: { plan: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Account not found');

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      studios: user.memberships.map((membership) => ({
        id: membership.studio.id,
        name: membership.studio.name,
        slug: membership.studio.slug,
        brandColor: membership.studio.brandColor,
        role: membership.role,
        status: membership.studio.status,
        subscription: membership.studio.subscription
          ? {
              status: membership.studio.subscription.status,
              interval: membership.studio.subscription.interval,
              currentPeriodEnd: membership.studio.subscription.currentPeriodEnd,
              trialEndsAt: membership.studio.subscription.trialEndsAt,
              plan: {
                id: membership.studio.subscription.plan.id,
                name: membership.studio.subscription.plan.name,
                slug: membership.studio.subscription.plan.slug,
              },
            }
          : null,
      })),
    };
  }

  async register(dto: RegisterDto, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const [existing] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const [preferredPlan] = await this.database.db
      .select()
      .from(plans)
      .where(eq(plans.slug, 'studio'))
      .limit(1);
    const [fallbackPlan] = preferredPlan
      ? []
      : await this.database.db
          .select()
          .from(plans)
          .where(eq(plans.isActive, true))
          .orderBy(asc(plans.sortOrder))
          .limit(1);
    const plan = preferredPlan ?? fallbackPlan;
    if (!plan) {
      throw new ServiceUnavailableException(
        'Subscription plans are not configured. Contact the platform administrator.',
      );
    }

    const passwordHash = await hash(dto.password, 12);
    const displayName = dto.name.trim();
    const studioName = dto.studioName?.trim() || `${displayName}'s Studio`;
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const user = await this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          name: displayName,
          role: UserRole.PHOTOGRAPHER,
          status: UserStatus.PENDING_VERIFICATION,
        })
        .returning();

      const [studio] = await tx
        .insert(studios)
        .values({
          name: studioName,
          slug: uniqueSlug(studioName),
          ownerId: created.id,
        })
        .returning();

      await tx.insert(studioMembers).values({
        studioId: studio.id,
        userId: created.id,
        role: 'OWNER',
      });

      await tx.insert(subscriptions).values({
        studioId: studio.id,
        planId: plan.id,
        status: SubscriptionStatus.TRIALING,
        interval: PlanInterval.MONTHLY,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEndsAt,
        trialEndsAt,
      });

      return created;
    });

    const rawToken = randomToken(32);
    const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
    await this.database.db
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.userId, user.id),
          eq(verificationTokens.type, VerificationTokenType.EMAIL_VERIFICATION),
          isNull(verificationTokens.consumedAt),
        ),
      );
    await this.database.db.insert(verificationTokens).values({
      userId: user.id,
      type: VerificationTokenType.EMAIL_VERIFICATION,
      tokenHash: hashToken(rawToken, pepper),
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
    });
    await this.mail.sendVerification(email, displayName, rawToken);
    await this.audit.record({
      actorId: user.id,
      action: 'AUTH_REGISTER',
      entity: 'user',
      entityId: user.id,
      metadata: { email, studioName },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      requiresVerification: true,
      email,
      message: 'Check your inbox to verify your email address.',
      ...(this.config.get<boolean>('exposeDevTokens') ? { devVerificationToken: rawToken } : {}),
    };
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !(await compare(dto.password, user.passwordHash))) {
      await this.audit.record({
        action: 'AUTH_LOGIN_FAILED',
        entity: 'user',
        metadata: { reason: 'invalid_credentials' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Incorrect email or password');
    }
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before signing in.',
      });
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account has been suspended. Contact support if you believe this is a mistake.',
      });
    }

    await this.database.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    const tokens = await this.issueSession(user, meta);
    const serializedUser = await this.serializeUser(user.id);

    await this.audit.record({
      actorId: user.id,
      action: 'AUTH_LOGIN',
      entity: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { ...tokens, user: serializedUser };
  }

  async refresh(rawRefreshToken: string | undefined, meta: RequestMeta) {
    if (!rawRefreshToken) throw new UnauthorizedException('Session expired');
    const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
    const tokenHash = hashToken(rawRefreshToken, pepper);

    const session = await this.database.db.query.userSessions.findFirst({
      where: eq(userSessions.refreshTokenHash, tokenHash),
      with: { user: true },
    });
    if (!session) throw new UnauthorizedException('Session expired');

    if (session.revokedAt) {
      // Refresh token reuse: revoke the entire token family.
      await this.database.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.familyId, session.familyId), isNull(userSessions.revokedAt)));
      await this.audit.record({
        actorId: session.userId,
        action: 'AUTH_REFRESH_REUSE_DETECTED',
        entity: 'user_session',
        entityId: session.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.database.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, session.id));
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      await this.database.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.familyId, session.familyId), isNull(userSessions.revokedAt)));
      throw new ForbiddenException('This account is not active');
    }

    const rawNext = randomToken(48);
    const refreshTtlDays = this.config.get<number>('jwt.refreshTtlDays') ?? 30;
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);
    const next = await this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(userSessions)
        .values({
          userId: session.userId,
          refreshTokenHash: hashToken(rawNext, pepper),
          familyId: session.familyId,
          expiresAt,
          ipHash: meta.ip ? hashToken(meta.ip, pepper) : null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
          lastUsedAt: new Date(),
        })
        .returning();
      await tx
        .update(userSessions)
        .set({
          revokedAt: new Date(),
          replacedBySessionId: created.id,
          lastUsedAt: new Date(),
        })
        .where(eq(userSessions.id, session.id));
      return created;
    });

    const accessToken = await this.signAccessToken(session.user, next.id);
    return {
      accessToken,
      refreshToken: rawNext,
      expiresIn: this.accessTtlSeconds(),
      sessionId: next.id,
      refreshExpiresAt: expiresAt,
      user: await this.serializeUser(session.userId),
    };
  }

  async logout(rawRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!rawRefreshToken) return;
    const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
    const tokenHash = hashToken(rawRefreshToken, pepper);
    const [session] = await this.database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, tokenHash))
      .limit(1);
    if (session && !session.revokedAt) {
      await this.database.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, session.id));
      await this.audit.record({
        actorId: session.userId,
        action: 'AUTH_LOGOUT',
        entity: 'user_session',
        entityId: session.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
  }

  async verifyEmail(token: string, meta: RequestMeta) {
    const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
    const record = await this.database.db.query.verificationTokens.findFirst({
      where: eq(verificationTokens.tokenHash, hashToken(token, pepper)),
      with: { user: true },
    });
    if (
      !record ||
      record.type !== VerificationTokenType.EMAIL_VERIFICATION ||
      record.consumedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('This verification link is invalid or has expired');
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(verificationTokens)
        .set({ consumedAt: new Date() })
        .where(eq(verificationTokens.id, record.id));
      await tx
        .update(users)
        .set({ status: UserStatus.ACTIVE, emailVerifiedAt: new Date() })
        .where(eq(users.id, record.userId));
    });

    const tokens = await this.issueSession(record.user, meta);
    await this.audit.record({
      actorId: record.userId,
      action: 'AUTH_EMAIL_VERIFIED',
      entity: 'user',
      entityId: record.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ...tokens, user: await this.serializeUser(record.userId) };
  }

  async resendVerification(emailAddress: string, meta: RequestMeta) {
    const email = emailAddress.trim().toLowerCase();
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (user && user.status === UserStatus.PENDING_VERIFICATION) {
      const rawToken = randomToken(32);
      const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
      await this.database.db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.userId, user.id),
            eq(verificationTokens.type, VerificationTokenType.EMAIL_VERIFICATION),
            isNull(verificationTokens.consumedAt),
          ),
        );
      await this.database.db.insert(verificationTokens).values({
        userId: user.id,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        tokenHash: hashToken(rawToken, pepper),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      });
      await this.mail.sendVerification(user.email, user.name, rawToken);
      await this.audit.record({
        actorId: user.id,
        action: 'AUTH_VERIFICATION_RESENT',
        entity: 'user',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return {
        message: 'If that email belongs to an unverified account, a new link is on its way.',
        ...(this.config.get<boolean>('exposeDevTokens') ? { devVerificationToken: rawToken } : {}),
      };
    }
    return { message: 'If that email belongs to an unverified account, a new link is on its way.' };
  }

  async forgotPassword(emailAddress: string, meta: RequestMeta) {
    const email = emailAddress.trim().toLowerCase();
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (user && user.status !== UserStatus.SUSPENDED) {
      const rawToken = randomToken(32);
      const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
      await this.database.db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.userId, user.id),
            eq(verificationTokens.type, VerificationTokenType.PASSWORD_RESET),
            isNull(verificationTokens.consumedAt),
          ),
        );
      await this.database.db.insert(verificationTokens).values({
        userId: user.id,
        type: VerificationTokenType.PASSWORD_RESET,
        tokenHash: hashToken(rawToken, pepper),
        expiresAt: new Date(Date.now() + PASSWORD_TOKEN_TTL_MS),
      });
      await this.mail.sendPasswordReset(user.email, user.name, rawToken);
      await this.audit.record({
        actorId: user.id,
        action: 'AUTH_PASSWORD_RESET_REQUESTED',
        entity: 'user',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return {
        message: 'If an account exists for that email, a reset link has been sent.',
        ...(this.config.get<boolean>('exposeDevTokens') ? { devResetToken: rawToken } : {}),
      };
    }
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta) {
    const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
    const record = await this.database.db.query.verificationTokens.findFirst({
      where: eq(verificationTokens.tokenHash, hashToken(dto.token, pepper)),
      with: { user: true },
    });
    if (
      !record ||
      record.type !== VerificationTokenType.PASSWORD_RESET ||
      record.consumedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }

    const passwordHash = await hash(dto.password, 12);
    await this.database.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, record.userId));
      await tx
        .update(verificationTokens)
        .set({ consumedAt: new Date() })
        .where(eq(verificationTokens.id, record.id));
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, record.userId), isNull(userSessions.revokedAt)));
    });

    await this.audit.record({
      actorId: record.userId,
      action: 'AUTH_PASSWORD_RESET',
      entity: 'user',
      entityId: record.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { message: 'Your password has been updated. Sign in with your new password.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto, currentSessionId: string | undefined, meta: RequestMeta) {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException('Account not found');
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Your current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Choose a password that is different from your current one');
    }
    const passwordHash = await hash(dto.newPassword, 12);
    await this.database.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userSessions.userId, userId),
            isNull(userSessions.revokedAt),
            currentSessionId ? ne(userSessions.id, currentSessionId) : undefined,
          ),
        );
    });
    await this.audit.record({
      actorId: userId,
      action: 'AUTH_PASSWORD_CHANGED',
      entity: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { message: 'Password updated. Other sessions have been signed out.' };
  }

  async me(userId: string) {
    return this.serializeUser(userId);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, meta: RequestMeta) {
    await this.database.db
      .update(users)
      .set({ name: dto.name.trim() })
      .where(eq(users.id, userId));
    await this.audit.record({
      actorId: userId,
      action: 'AUTH_PROFILE_UPDATED',
      entity: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.serializeUser(userId);
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.database.db
      .select({
        id: userSessions.id,
        createdAt: userSessions.createdAt,
        lastUsedAt: userSessions.lastUsedAt,
        expiresAt: userSessions.expiresAt,
        userAgent: userSessions.userAgent,
      })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(userSessions.lastUsedAt));
    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
      device: this.describeUserAgent(session.userAgent),
    }));
  }

  private describeUserAgent(userAgent: string | null): string {
    if (!userAgent) return 'Unknown device';
    if (/iphone|ipad/i.test(userAgent)) return 'Safari on iOS';
    if (/android/i.test(userAgent)) return 'Browser on Android';
    if (/edg\//i.test(userAgent)) return 'Microsoft Edge';
    if (/chrome/i.test(userAgent)) return 'Google Chrome';
    if (/firefox/i.test(userAgent)) return 'Mozilla Firefox';
    if (/safari/i.test(userAgent)) return 'Safari';
    return 'Web browser';
  }

  async revokeSession(userId: string, sessionId: string, meta: RequestMeta) {
    const [session] = await this.database.db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)))
      .limit(1);
    if (!session) throw new NotFoundException('Session not found');
    await this.database.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, sessionId));
    await this.audit.record({
      actorId: userId,
      action: 'AUTH_SESSION_REVOKED',
      entity: 'user_session',
      entityId: sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { message: 'Session signed out' };
  }

  async revokeOtherSessions(userId: string, currentSessionId: string | undefined, meta: RequestMeta) {
    const rows = await this.database.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          currentSessionId ? ne(userSessions.id, currentSessionId) : undefined,
        ),
      )
      .returning({ id: userSessions.id });
    await this.audit.record({
      actorId: userId,
      action: 'AUTH_ALL_SESSIONS_REVOKED',
      entity: 'user',
      entityId: userId,
      metadata: { count: rows.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { message: 'All other sessions have been signed out' };
  }

  isActive(user: AuthUser): boolean {
    return user.status === UserStatus.ACTIVE;
  }
}
