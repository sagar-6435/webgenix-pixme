import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { DrizzleModule } from './db/drizzle.module';
import { EventsModule } from './events/events.module';
import { FacesModule } from './faces/faces.module';
import { GuestModule } from './guest/guest.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PhotosModule } from './photos/photos.module';
import { ProcessingModule } from './processing/processing.module';
import { QrModule } from './qr/qr.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { StorageModule } from './storage/storage.module';
import { StudiosModule } from './studios/studios.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 180 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    DrizzleModule,
    RedisModule,
    StorageModule,
    AuditModule,
    MailModule,
    RealtimeModule,
    NotificationsModule,
    FacesModule,
    ProcessingModule,
    AuthModule,
    StudiosModule,
    BillingModule,
    EventsModule,
    PhotosModule,
    QrModule,
    GuestModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
