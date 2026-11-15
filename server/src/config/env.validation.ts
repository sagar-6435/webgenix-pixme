/**
 * Fail fast on missing or insecure configuration. `ConfigModule` calls this
 * before any provider is instantiated.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const env = { ...config } as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV ?? 'development';
  const errors: string[] = [];

  const required = [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_PEPPER',
    'GUEST_JWT_SECRET',
    'BIOMETRIC_ENCRYPTION_KEY',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET',
  ];
  for (const key of required) {
    if (!env[key]) errors.push(`${key} is required`);
  }

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_PEPPER', 'GUEST_JWT_SECRET']) {
    if (env[key] && env[key]!.length < 32) {
      errors.push(`${key} must be at least 32 characters`);
    }
  }

  if (env.BIOMETRIC_ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(env.BIOMETRIC_ENCRYPTION_KEY)) {
    errors.push('BIOMETRIC_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  if (env.BIOMETRIC_ENCRYPTION_KEY) {
    const weak = new Set([
      '0'.repeat(64),
      'a'.repeat(64),
      'f'.repeat(64),
      '1234567890abcdef'.repeat(4),
    ]);
    if (weak.has(env.BIOMETRIC_ENCRYPTION_KEY.toLowerCase()) && nodeEnv === 'production') {
      errors.push('BIOMETRIC_ENCRYPTION_KEY is a known placeholder; generate a real key');
    }
  }

  if (nodeEnv === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_PEPPER', 'GUEST_JWT_SECRET']) {
      if (env[key] && /^(__|changeme|secret|development)/i.test(env[key]!)) {
        errors.push(`${key} still contains a placeholder value`);
      }
    }
    if (env.EXPOSE_DEV_TOKENS === 'true') {
      errors.push('EXPOSE_DEV_TOKENS must be false in production');
    }
    if (env.CORS_ORIGINS?.includes('localhost')) {
      errors.push('CORS_ORIGINS must not contain localhost in production');
    }
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return env;
}
