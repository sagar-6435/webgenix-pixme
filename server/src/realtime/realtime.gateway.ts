import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import {
  EventStatus,
  GuestSessionStatus,
  UserStatus,
  events,
  guestSessions,
  studioMembers,
  users,
} from '../db/schema';
import type { Server, Socket } from 'socket.io';
import { DrizzleService } from '../db/drizzle.service';
import { RealtimeBus } from './realtime.bus';
import type { AccessTokenPayload, GuestTokenPayload } from '../common/types/auth.types';

interface SocketAuth {
  type: 'user' | 'guest';
  userId?: string;
  sessionId?: string;
  guestSessionId?: string;
  eventId?: string;
}

@WebSocketGateway({
  namespace: '/ws',
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private unsubscribe?: () => Promise<void>;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly database: DrizzleService,
    private readonly bus: RealtimeBus,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token as string | undefined;
        const type = (socket.handshake.auth?.type as 'user' | 'guest' | undefined) ?? 'user';
        if (!token) return next(new Error('Authentication required'));

        if (type === 'guest') {
          const payload = await this.jwt.verifyAsync<GuestTokenPayload>(token, {
            secret: this.config.getOrThrow<string>('jwt.guestSecret'),
          });
          if (payload.typ !== 'guest') return next(new Error('Invalid guest session'));
          const [session] = await this.database.db
            .select({
              id: guestSessions.id,
              eventId: guestSessions.eventId,
              status: guestSessions.status,
              expiresAt: guestSessions.expiresAt,
              studioId: events.studioId,
              eventStatus: events.status,
              galleryExpiresAt: events.galleryExpiresAt,
            })
            .from(guestSessions)
            .innerJoin(events, eq(events.id, guestSessions.eventId))
            .where(eq(guestSessions.id, payload.sub))
            .limit(1);
          if (
            !session ||
            session.eventId !== payload.eventId ||
            session.status === GuestSessionStatus.REVOKED ||
            session.status === GuestSessionStatus.EXPIRED ||
            session.expiresAt.getTime() <= Date.now() ||
            session.eventStatus === EventStatus.ARCHIVED ||
            (session.galleryExpiresAt && session.galleryExpiresAt.getTime() < Date.now())
          ) {
            return next(new Error('Guest session expired'));
          }
          socket.data.auth = {
            type: 'guest',
            guestSessionId: session.id,
            eventId: session.eventId,
            studioId: session.studioId,
          } satisfies SocketAuth & { studioId: string };
          return next();
        }

        const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
          secret: this.config.getOrThrow<string>('jwt.accessSecret'),
        });
        if (payload.typ !== 'access') return next(new Error('Invalid access token'));
        const [user] = await this.database.db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
        const memberships = await this.database.db
        .select({ studioId: studioMembers.studioId })
        .from(studioMembers)
        .where(eq(studioMembers.userId, payload.sub));
        if (!user || user.status !== UserStatus.ACTIVE) {
          return next(new Error('Account is not active'));
        }
        socket.data.auth = {
          type: 'user',
          userId: user.id,
          sessionId: payload.sid,
          studioIds: memberships.map((membership) => membership.studioId),
        } satisfies SocketAuth & { studioIds: string[] };
        return next();
      } catch (error) {
        this.logger.debug(`Socket auth failed: ${(error as Error).message}`);
        return next(new Error('Authentication required'));
      }
    });

    this.logger.log('Realtime gateway initialized');
    void this.bus
      .subscribe((message) => {
        this.server?.to(message.room).emit(message.event, message.payload);
      })
      .then((unsubscribe) => {
        this.unsubscribe = unsubscribe;
      })
      .catch((error) => {
        this.logger.error(`Realtime subscription failed: ${(error as Error).message}`);
      });
  }

  handleConnection(@ConnectedSocket() socket: Socket): void {
    const auth = socket.data.auth as (SocketAuth & { studioIds?: string[] }) | undefined;
    if (!auth) {
      socket.disconnect(true);
      return;
    }
    if (auth.type === 'user') {
      socket.join(`user:${auth.userId}`);
      for (const studioId of auth.studioIds ?? []) {
        socket.join(`studio:${studioId}`);
      }
    } else {
      socket.join(`guest:${auth.guestSessionId}`);
      socket.join(`event-guests:${auth.eventId}`);
    }
    socket.emit('connected', { ok: true, type: auth.type });
  }

  handleDisconnect(socket: Socket): void {
    this.logger.debug(`Socket disconnected: ${socket.id}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.unsubscribe?.();
  }

  emitToStudio(studioId: string, event: string, payload: unknown): void {
    void this.bus.publish({ room: `studio:${studioId}`, event, payload });
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    void this.bus.publish({ room: `user:${userId}`, event, payload });
  }

  emitToGuest(sessionId: string, event: string, payload: unknown): void {
    void this.bus.publish({ room: `guest:${sessionId}`, event, payload });
  }

  emitToEventGuests(eventId: string, event: string, payload: unknown): void {
    void this.bus.publish({ room: `event-guests:${eventId}`, event, payload });
  }
}
