import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { PhotoProcessor, type PhotoJobData } from './photo.processor';
import { GuestMatchProcessor, type GuestMatchJobData } from './guest-match.processor';
import { MaintenanceProcessor, type MaintenanceJobData } from './maintenance.processor';

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  workers: number;
}

export interface ProcessingStats {
  photo: QueueStats;
  guest: QueueStats;
  maintenance: QueueStats;
  workersEnabled: boolean;
}

@Injectable()
export class ProcessingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessingService.name);
  private photoQueue!: Queue;
  private guestQueue!: Queue;
  private maintenanceQueue!: Queue;
  private workers: Worker[] = [];
  private workersEnabled = false;
  private connection!: Record<string, unknown>;

  constructor(
    private readonly config: ConfigService,
    private readonly photoProcessor: PhotoProcessor,
    private readonly guestProcessor: GuestMatchProcessor,
    private readonly maintenanceProcessor: MaintenanceProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = this.redisConnection();
    const shared = { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS };
    this.photoQueue = new Queue('photo-processing', shared);
    this.guestQueue = new Queue('guest-matching', shared);
    this.maintenanceQueue = new Queue('maintenance', shared);

    await Promise.all([
      this.photoQueue.waitUntilReady(),
      this.guestQueue.waitUntilReady(),
      this.maintenanceQueue.waitUntilReady(),
    ]);

    this.workersEnabled = this.config.get<boolean>('runWorkers') !== false;
    if (this.workersEnabled) {
      this.startWorkers();
    } else {
      this.logger.warn('Queue workers are disabled in this process (RUN_WORKERS=false)');
    }

    // BullMQ schedulers are deduplicated across API instances.
    await Promise.all([
      this.maintenanceQueue.upsertJobScheduler(
        'guest-privacy-cleanup',
        { every: 30 * 60 * 1000 },
        {
          name: 'cleanup-guest-data',
          data: { type: 'cleanup-guest-data' } satisfies MaintenanceJobData,
          opts: { removeOnComplete: true },
        },
      ),
      this.maintenanceQueue.upsertJobScheduler(
        'biometric-cleanup',
        { every: 15 * 60 * 1000 },
        {
          name: 'cleanup-biometric',
          data: { type: 'cleanup-biometric' } satisfies MaintenanceJobData,
          opts: { removeOnComplete: true },
        },
      ),
    ]);
  }

  private redisConnection(): Record<string, unknown> {
    const url = new URL(this.config.getOrThrow<string>('redisUrl'));
    const dbPart = url.pathname.replace('/', '');
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: dbPart ? Number(dbPart) : 0,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }

  private startWorkers(): void {
    const concurrency = this.config.get<number>('queueConcurrency') ?? 2;
    const photoWorker = new Worker(
      'photo-processing',
      async (job: Job<PhotoJobData>) => this.photoProcessor.handle(job),
      {
        connection: this.connection,
        concurrency,
        lockDuration: 5 * 60 * 1000,
      },
    );
    const guestWorker = new Worker(
      'guest-matching',
      async (job: Job<GuestMatchJobData>) => this.guestProcessor.handle(job),
      {
        connection: this.connection,
        concurrency: Math.max(1, Math.min(concurrency, 4)),
        lockDuration: 2 * 60 * 1000,
      },
    );
    const maintenanceWorker = new Worker(
      'maintenance',
      async (job: Job<MaintenanceJobData>) => this.maintenanceProcessor.handle(job),
      {
        connection: this.connection,
        concurrency: 1,
        lockDuration: 10 * 60 * 1000,
      },
    );

    for (const worker of [photoWorker, guestWorker, maintenanceWorker]) {
      worker.on('failed', (job, error) => {
        this.logger.error(
          `Queue ${worker.name} job ${job?.id ?? 'unknown'} failed: ${error.message}`,
          error.stack,
        );
      });
      worker.on('error', (error) => {
        this.logger.error(`Worker ${worker.name} error: ${error.message}`);
      });
      this.workers.push(worker);
    }
    this.logger.log(
      `Queue workers started (photo concurrency: ${concurrency}, guest concurrency: ${Math.max(1, Math.min(concurrency, 4))})`,
    );
  }

  async enqueuePhoto(data: PhotoJobData): Promise<void> {
    await this.photoQueue.add('process-photo', data, {
      jobId: `photo-${data.photoId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  async enqueueGuestMatch(data: GuestMatchJobData): Promise<void> {
    await this.guestQueue.add('match-selfie', data, {
      jobId: `guest-${data.guestSessionId}-${Date.now()}`,
      attempts: 1,
      priority: 1,
    });
  }

  async enqueueDeleteEvent(eventId: string, studioId: string): Promise<void> {
    await this.maintenanceQueue.add(
      'delete-event',
      { type: 'delete-event', eventId, studioId } satisfies MaintenanceJobData,
      {
        jobId: `delete-event-${eventId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );
  }

  async enqueueCleanup(type: 'cleanup-guest-data' | 'cleanup-biometric'): Promise<void> {
    await this.maintenanceQueue.add(type, { type } satisfies MaintenanceJobData, {
      jobId: `${type}-${Date.now()}`,
      attempts: 2,
    });
  }

  async runCleanup(
    type: 'cleanup-guest-data' | 'cleanup-biometric',
  ): Promise<{ expired: number; purged: number } | { selfies: number; orphans: number }> {
    return type === 'cleanup-guest-data'
      ? this.maintenanceProcessor.cleanupGuestData()
      : this.maintenanceProcessor.cleanupBiometric();
  }

  async getStats(): Promise<ProcessingStats> {
    const counts = async (queue: Queue): Promise<QueueStats> => {
      const [jobCounts, workers] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
        queue.getWorkersCount(),
      ]);
      return {
        waiting: jobCounts.waiting ?? 0,
        active: jobCounts.active ?? 0,
        completed: jobCounts.completed ?? 0,
        failed: jobCounts.failed ?? 0,
        delayed: jobCounts.delayed ?? 0,
        paused: jobCounts.paused ?? 0,
        workers,
      };
    };

    const [photo, guest, maintenance] = await Promise.all([
      counts(this.photoQueue),
      counts(this.guestQueue),
      counts(this.maintenanceQueue),
    ]);
    return { photo, guest, maintenance, workersEnabled: this.workersEnabled };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close().catch(() => undefined)));
    await Promise.all(
      [this.photoQueue, this.guestQueue, this.maintenanceQueue]
        .filter(Boolean)
        .map((queue) => queue.close().catch(() => undefined)),
    );
  }
}
