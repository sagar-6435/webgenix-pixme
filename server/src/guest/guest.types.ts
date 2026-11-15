import { EventStatus, GuestSessionStatus } from '../db/schema';

export interface GuestRequestContext {
  id: string;
  eventId: string;
  status: GuestSessionStatus;
  expiresAt: Date;
  consentAt: Date;
  event: {
    id: string;
    name: string;
    slug: string;
    studioId: string;
    status: EventStatus;
    galleryExpiresAt: Date | null;
    brandColor: string;
    coverImageKey: string | null;
    locationName: string;
    city: string;
  };
  settings: {
    allowDownloads: boolean;
    allowFavorites: boolean;
    allowGuestSharing: boolean;
    guestSessionMinutes: number;
    selfieRetentionMinutes: number;
  };
}

export const DEFAULT_CONSENT_TEXT =
  'I agree to Pixme analysing the selfie I take now to find photographs of me from this event. ' +
  'My selfie is deleted immediately after analysis and is never stored as a biometric template. ' +
  'The numeric face signature from my selfie is kept only in memory for this matching request and is not saved. ' +
  'My matches are private to this browser session and are deleted when my session ends or when I withdraw consent. ' +
  'Photographs are processed only for this event and are never used to train AI models or identify me elsewhere.';

export const GUEST_ERROR_MESSAGES: Record<string, string> = {
  NO_FACE: 'We could not find a face. Face the camera in good light and try again.',
  MULTIPLE_FACES: 'We can see more than one face. Please make sure only you are in the photo.',
  NO_SELFIE: 'Your selfie expired before it could be processed. Please take another one.',
  LOW_QUALITY: 'Your face is not clear enough. Move into better light and try again.',
  MOVE_CLOSER: 'Move a little closer to the camera and try again.',
  LOW_LIGHT: 'It is too dark to see your face clearly. Find better light and try again.',
  GALLERY_CLOSED: 'This event gallery is no longer accepting face matches.',
  SELFIE_EXPIRED: 'Your selfie expired before analysis. Please try again.',
  PROCESSING_FAILED: 'We could not process that selfie. Please try again.',
  QUEUE_UNAVAILABLE: 'Face matching is temporarily unavailable. Please try again shortly.',
};
