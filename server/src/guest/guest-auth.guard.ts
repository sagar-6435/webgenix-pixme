import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EventStatus, GuestSessionStatus } from '../db/schema';
import type { Request } from 'express';
import { DrizzleService } from '../db/drizzle.service';
import type { GuestTokenPayload } from '../common/types/auth.types';
import type { GuestRequestContext } from './guest.types';

/**
 * Guests never register. They authenticate with a short-lived, event-scoped
 * JWT issued only after explicit biometric consent. The token is accepted from
 * the Authorization header (or a query parameter for direct download links).
 */
@Injectable()
export class GuestAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly database: DrizzleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const query = request.query as Record<string, string | undefined>;
    const token = bearer ?? query.token ?? query.access_token;

    if (!token) {
      throw new UnauthorizedException('A guest session is required');
    }

    let payload: GuestTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<GuestTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('jwt.guestSecret'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'GUEST_TOKEN_INVALID',
        message: 'Your guest session has ended. Scan the event QR code again.',
      });
    }

    if (payload.typ !== 'guest') {
      throw new UnauthorizedException('Invalid guest session');
    }

    const session = await this.database.db.query.guestSessions.findFirst({
      where: (sessions, operators) => operators.eq(sessions.id, payload.sub),
      with: { event: { with: { settings: true, studio: true } } },
    });

    if (!session || session.eventId !== payload.eventId) {
      throw new UnauthorizedException({
        code: 'GUEST_SESSION_NOT_FOUND',
        message: 'Your guest session has ended. Scan the event QR code again.',
      });
    }

    if (
      session.status === GuestSessionStatus.REVOKED ||
      session.status === GuestSessionStatus.EXPIRED ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new ForbiddenException({
        code: 'GUEST_SESSION_EXPIRED',
        message: 'Your private gallery session has expired. Scan the QR code to start again.',
      });
    }

    if (
      session.event.status !== EventStatus.PUBLISHED ||
      (session.event.galleryExpiresAt && session.event.galleryExpiresAt.getTime() < Date.now())
    ) {
      throw new ForbiddenException({
        code: 'GALLERY_CLOSED',
        message: 'This event gallery is no longer accepting face matches.',
      });
    }

    const guestContext: GuestRequestContext = {
      id: session.id,
      eventId: session.eventId,
      status: session.status,
      expiresAt: session.expiresAt,
      consentAt: session.consentAt,
      event: {
        id: session.event.id,
        name: session.event.name,
        slug: session.event.slug,
        studioId: session.event.studioId,
        status: session.event.status,
        galleryExpiresAt: session.event.galleryExpiresAt,
        brandColor: session.event.brandColor,
        coverImageKey: session.event.coverImageKey,
        locationName: session.event.locationName,
        city: session.event.city,
      },
      settings: {
        allowDownloads: session.event.settings?.allowDownloads ?? true,
        allowFavorites: session.event.settings?.allowFavorites ?? true,
        allowGuestSharing: session.event.settings?.allowGuestSharing ?? false,
        guestSessionMinutes: session.event.settings?.guestSessionMinutes ?? 120,
        selfieRetentionMinutes: session.event.settings?.selfieRetentionMinutes ?? 15,
      },
    };

    (request as Request & { guestSession?: GuestRequestContext }).guestSession = guestContext;
    return true;
  }
}
