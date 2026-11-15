import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Injectable } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';

/**
 * Redis-backed fixed-window throttling so limits hold across API replicas.
 * TTLs are milliseconds; the returned times are seconds for HTTP headers.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.getClient();
    const blockKey = `${key}:blocked`;
    const blockedFor = await client.pttl(blockKey);
    if (blockedFor > 0) {
      const counterTtl = await client.pttl(key);
      return {
        totalHits: limit + 1,
        timeToExpire: Math.max(1, Math.ceil(Math.max(counterTtl, 1) / 1000)),
        isBlocked: true,
        timeToBlockExpire: Math.max(1, Math.ceil(blockedFor / 1000)),
      };
    }

    const totalHits = Number(
      await client.eval(
        `local current = redis.call('INCR', KEYS[1])
         if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
         return current`,
        1,
        key,
        Math.max(1, ttl),
      ),
    );
    let timeToExpire = await client.pttl(key);
    if (timeToExpire < 0) {
      await client.pexpire(key, Math.max(1, ttl));
      timeToExpire = ttl;
    }

    const isBlocked = totalHits > limit;
    let timeToBlockExpire = 0;
    if (isBlocked) {
      const duration = Math.max(blockDuration > 0 ? blockDuration : ttl, 1000);
      await client.set(blockKey, '1', 'PX', duration, 'NX');
      timeToBlockExpire = Math.max(1, Math.ceil((await client.pttl(blockKey)) / 1000));
    }

    return {
      totalHits,
      timeToExpire: Math.max(1, Math.ceil(timeToExpire / 1000)),
      isBlocked,
      timeToBlockExpire,
    };
  }
}
