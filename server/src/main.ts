import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';

class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: NestExpressApplication,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.origins,
        credentials: true,
        methods: ['GET', 'POST'],
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService);
  const env = config.get<string>('env') ?? 'development';
  const port = config.get<number>('port') ?? 4000;
  const corsOrigins = config.get<string[]>('corsOrigins') ?? ['http://localhost:3000'];

  app.set('trust proxy', config.get<boolean>('trustProxy') ? 1 : false);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Studio-Id', 'X-Request-Id'],
    exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'Retry-After'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, corsOrigins));
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('Pixme API')
    .setDescription(
      'Multi-tenant event photography platform with private, consent-based face matching. ' +
        'Photographer and platform routes use bearer JWTs; guest routes use short-lived event-scoped tokens.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Authentication')
    .addTag('Events')
    .addTag('Photos')
    .addTag('QR Codes')
    .addTag('Guest Experience')
    .addTag('Studios')
    .addTag('Billing')
    .addTag('Analytics')
    .addTag('Platform Admin')
    .addTag('Health')
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    customSiteTitle: 'Pixme API documentation',
  });

  const server = await app.listen(port, '0.0.0.0');
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  logger.log(`Pixme API listening on http://localhost:${listeningPort}/api (${env})`);
  logger.log(`Swagger docs at http://localhost:${listeningPort}/api/docs`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start Pixme API', error instanceof Error ? error.stack : String(error));
  console.error(error);
  process.exit(1);
});
