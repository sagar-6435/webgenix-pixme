import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(value: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Refresh and invite tokens are stored only as hashes. */
export function hashToken(token: string, pepper: string): string {
  return hmacSha256(token, pepper);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function parseEncryptionKey(raw: string): Buffer {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('Biometric encryption key must be 32 bytes');
  }
  return key;
}

/**
 * AES-256-GCM envelope: v1.<iv>.<tag>.<ciphertext>, base64url encoded.
 * AAD binds an embedding to its event + photo and prevents ciphertext swapping.
 */
export function encryptBuffer(plaintext: Buffer, key: Buffer, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptBuffer(envelope: string, key: Buffer, aad?: string): Buffer {
  const [version, ivPart, tagPart, dataPart] = envelope.split('.');
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]);
}

export function encryptEmbedding(values: number[], key: Buffer, aad: string): string {
  const buffer = Buffer.allocUnsafe(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return encryptBuffer(buffer, key, aad);
}

export function decryptEmbedding(envelope: string, key: Buffer, aad: string): Float32Array {
  const buffer = decryptBuffer(envelope, key, aad);
  const result = new Float32Array(buffer.length / 4);
  for (let i = 0; i < result.length; i += 1) {
    result[i] = buffer.readFloatLE(i * 4);
  }
  return result;
}

export function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'photo';
  return base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 96) || 'photo';
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function uniqueSlug(value: string, suffixLength = 6): string {
  const base = slugify(value) || 'event';
  return `${base}-${randomBytes(suffixLength).toString('hex').slice(0, suffixLength)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
