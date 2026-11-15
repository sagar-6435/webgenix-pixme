import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface RealtimeMessage {
  room: string;
  event: string;
  payload: unknown;
}

const CHANNEL = 'pixme:realtime:v1';

/**
 * Redis pub/sub fan-out. Any process (API instance or background worker) can
 * publish; every API instance broadcasts to its locally connected sockets.
 * This keeps realtime working when workers scale independently.
 */
@Injectable()
export class RealtimeBus {
  private readonly logger = new Logger(RealtimeBus.name);

  constructor(private readonly redis: RedisService) {}

  async publish(message: RealtimeMessage): Promise<void> {
    try {
      await this.redis.getClient().publish(CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.warn(`Realtime publish failed: ${(error as Error).message}`);
    }
  }

  async subscribe(handler: (message: RealtimeMessage) => void): Promise<() => Promise<void>> {
    const subscriber = this.redis.getClient().duplicate({ lazyConnect: false });
    subscriber.on('error', (error) => this.logger.warn(`Realtime subscriber: ${error.message}`));
    subscriber.on('message', (channel, raw) => {
      if (channel !== CHANNEL) return;
      try {
        const message = JSON.parse(raw) as RealtimeMessage;
        if (message?.room && message?.event) handler(message);
      } catch {
        // Ignore malformed messages; never let a bad event break the gateway.
      }
    });
    await subscriber.subscribe(CHANNEL);
    return async () => {
      await subscriber.quit();
    };
  }
}
