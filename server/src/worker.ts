import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Dedicated BullMQ worker process. API instances run with RUN_WORKERS=false
 * while this process owns the heavy AI queues. Realtime events are published
 * through Redis and delivered by every API instance's Socket.IO gateway.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();

  logger.log('Pixme worker online — listening for photo indexing and guest matching jobs');

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}; draining queues`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await new Promise<void>(() => undefined);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Worker');
  logger.error(
    'Failed to start Pixme worker',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
