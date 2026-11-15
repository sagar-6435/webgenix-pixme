export interface AppConfig {
  env: string;
  port: number;
  appUrl: string;
  apiUrl: string;
  corsOrigins: string[];
  trustProxy: boolean;
  databaseUrl: string;
  redisUrl: string;
  queueConcurrency: number;
  runWorkers: boolean;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshPepper: string;
    refreshTtlDays: number;
    guestSecret: string;
    cookieSecure: boolean;
    cookieName: string;
  };
  biometricEncryptionKey: string;
  storage: {
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    forcePathStyle: boolean;
    signedUrlTtl: number;
  };
  mail: {
    transport: 'console' | 'smtp';
    from: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPassword?: string;
    smtpSecure?: boolean;
  };
  exposeDevTokens: boolean;
  ai: {
    engine: string;
    modelDir?: string;
    minConfidence: number;
    matchThreshold: number;
  };
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default (): AppConfig => {
  const env = process.env.NODE_ENV ?? 'development';
  return {
    env,
    port: num(process.env.PORT, 4000),
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    apiUrl: process.env.API_URL ?? 'http://localhost:4000',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: bool(process.env.TRUST_PROXY, false),
    databaseUrl: process.env.DATABASE_URL ?? '',
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    queueConcurrency: num(process.env.AI_QUEUE_CONCURRENCY, 2),
    runWorkers: bool(process.env.RUN_WORKERS, true),
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshPepper: process.env.JWT_REFRESH_PEPPER ?? '',
      refreshTtlDays: num(process.env.JWT_REFRESH_TTL_DAYS, 30),
      guestSecret: process.env.GUEST_JWT_SECRET ?? '',
      cookieSecure: env === 'production' || bool(process.env.COOKIE_SECURE, false),
      cookieName: process.env.REFRESH_COOKIE_NAME ?? 'pixme_refresh',
    },
    biometricEncryptionKey: process.env.BIOMETRIC_ENCRYPTION_KEY ?? '',
    storage: {
      endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKey: process.env.S3_ACCESS_KEY ?? '',
      secretKey: process.env.S3_SECRET_KEY ?? '',
      bucket: process.env.S3_BUCKET ?? 'pixme',
      forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
      signedUrlTtl: num(process.env.SIGNED_URL_TTL_SECONDS, 900),
    },
    mail: {
      transport: (process.env.MAIL_TRANSPORT === 'smtp' ? 'smtp' : 'console') as
        | 'console'
        | 'smtp',
      from: process.env.MAIL_FROM ?? 'Pixme <contact@pixme.app>',
      smtpHost: process.env.SMTP_HOST,
      smtpPort: num(process.env.SMTP_PORT, 587),
      smtpUser: process.env.SMTP_USER,
      smtpPassword: process.env.SMTP_PASSWORD,
      smtpSecure: bool(process.env.SMTP_SECURE, false),
    },
    exposeDevTokens: bool(process.env.EXPOSE_DEV_TOKENS, false),
    ai: {
      engine: process.env.FACE_ENGINE ?? 'face-api',
      modelDir: process.env.FACE_MODEL_DIR || undefined,
      minConfidence: num(process.env.FACE_DETECTION_MIN_CONFIDENCE, 0.55),
      matchThreshold: num(process.env.FACE_MATCH_THRESHOLD, 0.52),
    },
  };
};
