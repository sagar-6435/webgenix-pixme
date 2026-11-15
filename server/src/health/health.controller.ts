import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { DrizzleService } from '../db/drizzle.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';

type CheckState = 'up' | 'down';

interface HealthCheck {
  status: CheckState;
  latencyMs: number;
  error?: string;
}

@ApiTags('Health')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DrizzleService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  private async check(fn: () => Promise<unknown>): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await fn();
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: (error as Error).name || 'unavailable',
      };
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  @ApiOperation({ summary: 'Dependency readiness probe' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis, objectStorage] = await Promise.all([
      this.check(() => this.database.ping()),
      this.check(() => this.redis.ping()),
      this.check(() => this.storage.healthCheck()),
    ]);
    const healthy =
      database.status === 'up' && redis.status === 'up' && objectStorage.status === 'up';

    res.status(healthy ? 200 : 503);
    return {
      status: healthy ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '1.0.0',
      environment: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: {
        database,
        redis,
        objectStorage,
      },
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe alias' })
  async readyAlias(@Res({ passthrough: true }) res: Response) {
    return this.ready(res);
  }
}
