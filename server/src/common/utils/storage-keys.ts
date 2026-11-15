import { randomUUID } from 'crypto';
import { sanitizeFilename } from './crypto.util';

export const eventStoragePrefix = (studioId: string, eventId: string): string =>
  `studios/${studioId}/events/${eventId}/`;

export const originalKey = (
  studioId: string,
  eventId: string,
  photoId: string,
  filename: string,
): string => `${eventStoragePrefix(studioId, eventId)}originals/${photoId}-${sanitizeFilename(filename)}`;

export const thumbnailKey = (studioId: string, eventId: string, photoId: string): string =>
  `${eventStoragePrefix(studioId, eventId)}thumbnails/${photoId}.webp`;

export const previewKey = (studioId: string, eventId: string, photoId: string): string =>
  `${eventStoragePrefix(studioId, eventId)}previews/${photoId}.webp`;

export const eventCoverKey = (studioId: string, eventId: string): string =>
  `${eventStoragePrefix(studioId, eventId)}branding/cover-${Date.now()}.jpg`;

export const eventLogoKey = (studioId: string, eventId: string): string =>
  `${eventStoragePrefix(studioId, eventId)}branding/logo-${Date.now()}.webp`;

export const studioLogoKey = (studioId: string): string =>
  `studios/${studioId}/branding/logo-${Date.now()}.webp`;

export const userAvatarKey = (userId: string): string =>
  `users/${userId}/avatar-${Date.now()}.webp`;

export const guestSelfieKey = (eventId: string, sessionId: string, extension = 'jpg'): string =>
  `biometric/${eventId}/${sessionId}/${randomUUID()}.${extension.replace(/[^a-z0-9]/gi, '') || 'jpg'}`;

export const biometricPrefix = (eventId?: string): string =>
  eventId ? `biometric/${eventId}/` : 'biometric/';
