import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Owns the PostgreSQL connection pool and the Drizzle query builder.
 * Owns the application's PostgreSQL access layer.
 */
@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  readonly pool: Pool;
  readonly db: Database;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('databaseUrl'),
      max: config.get<number>('databasePoolSize') ?? 10,
    });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Used by health checks. */
  async ping(): Promise<number> {
    const start = Date.now();
    await this.pool.query('SELECT 1');
    return Date.now() - start;
  }
}
