import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleService } from '../db/drizzle.service';
import { auditLogs } from '../db/schema';
import { hashToken } from '../common/utils/crypto.util';

export interface AuditInput {
  studioId?: string | null;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly database: DrizzleService,
    private readonly config: ConfigService,
  ) {}

  async record(input: AuditInput): Promise<void> {
    try {
      const pepper = this.config.getOrThrow<string>('jwt.refreshPepper');
      await this.database.db.insert(auditLogs).values({
        studioId: input.studioId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? null,
        ipHash: input.ip ? hashToken(input.ip, pepper) : null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      });
    } catch (error) {
      // Audit failures must never break the primary operation.
      this.logger.warn(`Audit log failed: ${(error as Error).message}`);
    }
  }
}
