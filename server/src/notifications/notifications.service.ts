import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service';
import { NotificationType, notifications } from '../db/schema';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { paginate } from '../common/utils/pagination.util';

export interface CreateNotificationInput {
  studioId: string;
  userId?: string | null;
  eventId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DrizzleService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(input: CreateNotificationInput) {
    const [notification] = await this.database.db
      .insert(notifications)
      .values({
        studioId: input.studioId,
        userId: input.userId ?? null,
        eventId: input.eventId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? null,
      })
      .returning();
    this.realtime.emitToStudio(input.studioId, 'notification.created', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      eventId: notification.eventId,
      createdAt: notification.createdAt,
    });
    if (input.userId) {
      this.realtime.emitToUser(input.userId, 'notification.created', {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        eventId: notification.eventId,
        createdAt: notification.createdAt,
      });
    }
    return notification;
  }

  async list(studioId: string, page: number, limit: number, unreadOnly = false) {
    const where = unreadOnly
      ? and(eq(notifications.studioId, studioId), isNull(notifications.readAt))
      : eq(notifications.studioId, studioId);
    const [items, totalRows, unreadRows] = await Promise.all([
      this.database.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.database.db
        .select({ value: count() })
        .from(notifications)
        .where(where),
      this.database.db
        .select({ value: count() })
        .from(notifications)
        .where(and(eq(notifications.studioId, studioId), isNull(notifications.readAt))),
    ]);
    const total = Number(totalRows[0]?.value ?? 0);
    const unread = Number(unreadRows[0]?.value ?? 0);
    return { ...paginate(items, total, page, limit), unread };
  }

  async markRead(studioId: string, id: string) {
    const rows = await this.database.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.studioId, studioId)))
      .returning({ id: notifications.id });
    return { count: rows.length };
  }

  async markAllRead(studioId: string) {
    const rows = await this.database.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.studioId, studioId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }
}
