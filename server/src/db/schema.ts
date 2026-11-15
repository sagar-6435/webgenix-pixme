// Pixme database schema — Drizzle ORM (PostgreSQL).
// All tenant-owned entities are reachable from Studio and every query in the
// application is scoped by studioId / eventId. Table and column names are kept
// Table and column names remain stable so existing databases keep working.
import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// Enums (exported as const objects for application code)
// ─────────────────────────────────────────────────────────────

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  PHOTOGRAPHER: 'PHOTOGRAPHER',
  STUDIO_ADMIN: 'STUDIO_ADMIN',
  STUDIO_STAFF: 'STUDIO_STAFF',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const StudioRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
} as const;
export type StudioRole = (typeof StudioRole)[keyof typeof StudioRole];

export const StudioStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type StudioStatus = (typeof StudioStatus)[keyof typeof StudioStatus];

export const VerificationTokenType = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;
export type VerificationTokenType =
  (typeof VerificationTokenType)[keyof typeof VerificationTokenType];

export const StudioInviteStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REVOKED: 'REVOKED',
} as const;
export type StudioInviteStatus =
  (typeof StudioInviteStatus)[keyof typeof StudioInviteStatus];

export const PlanInterval = {
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const;
export type PlanInterval = (typeof PlanInterval)[keyof typeof PlanInterval];

export const SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
  EXPIRED: 'EXPIRED',
} as const;
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const InvoiceStatus = {
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const EventCategory = {
  WEDDING: 'WEDDING',
  ENGAGEMENT: 'ENGAGEMENT',
  RECEPTION: 'RECEPTION',
  BIRTHDAY: 'BIRTHDAY',
  ANNIVERSARY: 'ANNIVERSARY',
  CORPORATE: 'CORPORATE',
  COLLEGE: 'COLLEGE',
  CULTURAL: 'CULTURAL',
  OTHER: 'OTHER',
} as const;
export type EventCategory = (typeof EventCategory)[keyof typeof EventCategory];

export const EventStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const PhotoStatus = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type PhotoStatus = (typeof PhotoStatus)[keyof typeof PhotoStatus];

export const GuestSessionStatus = {
  CONSENTED: 'CONSENTED',
  PROCESSING: 'PROCESSING',
  MATCHED: 'MATCHED',
  NO_MATCHES: 'NO_MATCHES',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type GuestSessionStatus =
  (typeof GuestSessionStatus)[keyof typeof GuestSessionStatus];

export const StorageKind = {
  ORIGINAL: 'ORIGINAL',
  THUMBNAIL: 'THUMBNAIL',
  PREVIEW: 'PREVIEW',
  COVER: 'COVER',
  LOGO: 'LOGO',
  SELFIE: 'SELFIE',
  POSTER: 'POSTER',
} as const;
export type StorageKind = (typeof StorageKind)[keyof typeof StorageKind];

export const DownloadKind = {
  SINGLE: 'SINGLE',
  BULK: 'BULK',
  SHARE: 'SHARE',
} as const;
export type DownloadKind = (typeof DownloadKind)[keyof typeof DownloadKind];

export const NotificationType = {
  UPLOAD_COMPLETE: 'UPLOAD_COMPLETE',
  PROCESSING_COMPLETE: 'PROCESSING_COMPLETE',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  GALLERY_UPDATED: 'GALLERY_UPDATED',
  STORAGE_WARNING: 'STORAGE_WARNING',
  SUBSCRIPTION: 'SUBSCRIPTION',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

type EnumValues<T extends Record<string, string>> = [T[keyof T], ...T[keyof T][]];

export const userRoleEnum = pgEnum('UserRole', Object.values(UserRole) as EnumValues<typeof UserRole>);
export const userStatusEnum = pgEnum(
  'UserStatus',
  Object.values(UserStatus) as EnumValues<typeof UserStatus>,
);
export const studioRoleEnum = pgEnum(
  'StudioRole',
  Object.values(StudioRole) as EnumValues<typeof StudioRole>,
);
export const studioStatusEnum = pgEnum(
  'StudioStatus',
  Object.values(StudioStatus) as EnumValues<typeof StudioStatus>,
);
export const verificationTokenTypeEnum = pgEnum(
  'VerificationTokenType',
  Object.values(VerificationTokenType) as EnumValues<typeof VerificationTokenType>,
);
export const studioInviteStatusEnum = pgEnum(
  'StudioInviteStatus',
  Object.values(StudioInviteStatus) as EnumValues<typeof StudioInviteStatus>,
);
export const planIntervalEnum = pgEnum(
  'PlanInterval',
  Object.values(PlanInterval) as EnumValues<typeof PlanInterval>,
);
export const subscriptionStatusEnum = pgEnum(
  'SubscriptionStatus',
  Object.values(SubscriptionStatus) as EnumValues<typeof SubscriptionStatus>,
);
export const invoiceStatusEnum = pgEnum(
  'InvoiceStatus',
  Object.values(InvoiceStatus) as EnumValues<typeof InvoiceStatus>,
);
export const eventCategoryEnum = pgEnum(
  'EventCategory',
  Object.values(EventCategory) as EnumValues<typeof EventCategory>,
);
export const eventStatusEnum = pgEnum(
  'EventStatus',
  Object.values(EventStatus) as EnumValues<typeof EventStatus>,
);
export const photoStatusEnum = pgEnum(
  'PhotoStatus',
  Object.values(PhotoStatus) as EnumValues<typeof PhotoStatus>,
);
export const guestSessionStatusEnum = pgEnum(
  'GuestSessionStatus',
  Object.values(GuestSessionStatus) as EnumValues<typeof GuestSessionStatus>,
);
export const storageKindEnum = pgEnum(
  'StorageKind',
  Object.values(StorageKind) as EnumValues<typeof StorageKind>,
);
export const downloadKindEnum = pgEnum(
  'DownloadKind',
  Object.values(DownloadKind) as EnumValues<typeof DownloadKind>,
);
export const notificationTypeEnum = pgEnum(
  'NotificationType',
  Object.values(NotificationType) as EnumValues<typeof NotificationType>,
);

// ─────────────────────────────────────────────────────────────
// Column helpers
// ─────────────────────────────────────────────────────────────

const primaryId = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId());

const createdAt = () =>
  timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow();

const updatedAt = () =>
  timestamp('updatedAt', { precision: 3, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ─────────────────────────────────────────────────────────────
// Identity & tenancy
// ─────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    passwordHash: text('passwordHash').notNull(),
    name: text('name').notNull(),
    role: userRoleEnum('role').notNull().default('PHOTOGRAPHER'),
    status: userStatusEnum('status').notNull().default('PENDING_VERIFICATION'),
    emailVerifiedAt: timestamp('emailVerifiedAt', { precision: 3, mode: 'date' }),
    avatarKey: text('avatarKey'),
    lastLoginAt: timestamp('lastLoginAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    index('users_status_idx').on(t.status),
    index('users_role_idx').on(t.role),
  ],
);

export const studios = pgTable(
  'studios',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    status: studioStatusEnum('status').notNull().default('ACTIVE'),
    logoKey: text('logoKey'),
    brandColor: text('brandColor').notNull().default('#FF5A36'),
    timezone: text('timezone').notNull().default('UTC'),
    storageUsedBytes: doublePrecision('storageUsedBytes').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('studios_slug_key').on(t.slug),
    index('studios_ownerId_idx').on(t.ownerId),
    index('studios_status_idx').on(t.status),
  ],
);

export const studioMembers = pgTable(
  'studio_members',
  {
    id: primaryId(),
    studioId: text('studioId')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    role: studioRoleEnum('role').notNull().default('STAFF'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('studio_members_studioId_userId_key').on(t.studioId, t.userId),
    index('studio_members_userId_idx').on(t.userId),
  ],
);

export const studioInvites = pgTable(
  'studio_invites',
  {
    id: primaryId(),
    studioId: text('studioId')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    email: text('email').notNull(),
    role: studioRoleEnum('role').notNull().default('STAFF'),
    status: studioInviteStatusEnum('status').notNull().default('PENDING'),
    tokenHash: text('tokenHash').notNull(),
    invitedById: text('invitedById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    acceptedAt: timestamp('acceptedAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('studio_invites_tokenHash_key').on(t.tokenHash),
    uniqueIndex('studio_invites_studioId_email_key').on(t.studioId, t.email),
    index('studio_invites_email_idx').on(t.email),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: primaryId(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    refreshTokenHash: text('refreshTokenHash').notNull(),
    familyId: text('familyId').notNull(),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    revokedAt: timestamp('revokedAt', { precision: 3, mode: 'date' }),
    replacedBySessionId: text('replacedBySessionId'),
    ipHash: text('ipHash'),
    userAgent: text('userAgent'),
    lastUsedAt: timestamp('lastUsedAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_sessions_refreshTokenHash_key').on(t.refreshTokenHash),
    index('user_sessions_userId_idx').on(t.userId),
    index('user_sessions_familyId_idx').on(t.familyId),
    index('user_sessions_expiresAt_idx').on(t.expiresAt),
  ],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: primaryId(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    type: verificationTokenTypeEnum('type').notNull(),
    tokenHash: text('tokenHash').notNull(),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumedAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('verification_tokens_tokenHash_key').on(t.tokenHash),
    index('verification_tokens_userId_type_idx').on(t.userId, t.type),
    index('verification_tokens_expiresAt_idx').on(t.expiresAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────

export const plans = pgTable(
  'plans',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    priceMonthly: numeric('priceMonthly', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    priceYearly: numeric('priceYearly', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    currency: text('currency').notNull().default('USD'),
    maxEvents: integer('maxEvents').notNull().default(3),
    maxPhotosPerEvent: integer('maxPhotosPerEvent').notNull().default(1000),
    maxStorageGb: integer('maxStorageGb').notNull().default(10),
    maxTeamMembers: integer('maxTeamMembers').notNull().default(1),
    features: jsonb('features')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isActive: boolean('isActive').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('plans_slug_key').on(t.slug)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryId(),
    studioId: text('studioId')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    planId: text('planId')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    status: subscriptionStatusEnum('status').notNull().default('TRIALING'),
    interval: planIntervalEnum('interval').notNull().default('MONTHLY'),
    currentPeriodStart: timestamp('currentPeriodStart', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp('currentPeriodEnd', { precision: 3, mode: 'date' }).notNull(),
    trialEndsAt: timestamp('trialEndsAt', { precision: 3, mode: 'date' }),
    cancelAtPeriodEnd: boolean('cancelAtPeriodEnd').notNull().default(false),
    canceledAt: timestamp('canceledAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscriptions_studioId_key').on(t.studioId),
    index('subscriptions_planId_idx').on(t.planId),
    index('subscriptions_status_idx').on(t.status),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: primaryId(),
    number: text('number').notNull(),
    subscriptionId: text('subscriptionId')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    studioId: text('studioId')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    status: invoiceStatusEnum('status').notNull().default('OPEN'),
    description: text('description').notNull().default(''),
    periodStart: timestamp('periodStart', { precision: 3, mode: 'date' }).notNull(),
    periodEnd: timestamp('periodEnd', { precision: 3, mode: 'date' }).notNull(),
    paidAt: timestamp('paidAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_key').on(t.number),
    index('invoices_studioId_createdAt_idx').on(t.studioId, t.createdAt),
    index('invoices_status_idx').on(t.status),
  ],
);

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    id: primaryId(),
    studioId: text('studioId')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    createdById: text('createdById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    category: eventCategoryEnum('category').notNull().default('OTHER'),
    description: text('description').notNull().default(''),
    status: eventStatusEnum('status').notNull().default('DRAFT'),
    startAt: timestamp('startAt', { precision: 3, mode: 'date' }).notNull(),
    endAt: timestamp('endAt', { precision: 3, mode: 'date' }),
    locationName: text('locationName').notNull().default(''),
    locationAddress: text('locationAddress').notNull().default(''),
    city: text('city').notNull().default(''),
    country: text('country').notNull().default(''),
    coverImageKey: text('coverImageKey'),
    logoKey: text('logoKey'),
    brandColor: text('brandColor').notNull().default('#FF5A36'),
    galleryExpiresAt: timestamp('galleryExpiresAt', { precision: 3, mode: 'date' }),
    isDiscoverable: boolean('isDiscoverable').notNull().default(true),
    photoCount: integer('photoCount').notNull().default(0),
    faceCount: integer('faceCount').notNull().default(0),
    guestCount: integer('guestCount').notNull().default(0),
    downloadCount: integer('downloadCount').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('events_slug_key').on(t.slug),
    index('events_studioId_status_idx').on(t.studioId, t.status),
    index('events_studioId_startAt_idx').on(t.studioId, t.startAt),
    index('events_slug_idx').on(t.slug),
  ],
);

export const eventSettings = pgTable(
  'event_settings',
  {
    id: primaryId(),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    matchThreshold: doublePrecision('matchThreshold').notNull().default(0.52),
    minFaceConfidence: doublePrecision('minFaceConfidence').notNull().default(0.65),
    maxPhotosPerMatch: integer('maxPhotosPerMatch').notNull().default(500),
    guestSessionMinutes: integer('guestSessionMinutes').notNull().default(120),
    selfieRetentionMinutes: integer('selfieRetentionMinutes').notNull().default(15),
    allowDownloads: boolean('allowDownloads').notNull().default(true),
    allowFavorites: boolean('allowFavorites').notNull().default(true),
    allowGuestSharing: boolean('allowGuestSharing').notNull().default(false),
    watermarkDownloads: boolean('watermarkDownloads').notNull().default(false),
    consentVersion: text('consentVersion').notNull().default('2026-01'),
    consentText: text('consentText'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('event_settings_eventId_key').on(t.eventId)],
);

export const photos = pgTable(
  'photos',
  {
    id: primaryId(),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    uploadedById: text('uploadedById').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    storageKey: text('storageKey').notNull(),
    thumbnailKey: text('thumbnailKey'),
    previewKey: text('previewKey'),
    originalFilename: text('originalFilename').notNull(),
    mimeType: text('mimeType').notNull(),
    sizeBytes: integer('sizeBytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    checksum: text('checksum').notNull(),
    status: photoStatusEnum('status').notNull().default('QUEUED'),
    processingError: text('processingError'),
    faceCount: integer('faceCount').notNull().default(0),
    takenAt: timestamp('takenAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('photos_storageKey_key').on(t.storageKey),
    uniqueIndex('photos_eventId_checksum_key').on(t.eventId, t.checksum),
    index('photos_eventId_status_idx').on(t.eventId, t.status),
    index('photos_eventId_createdAt_idx').on(t.eventId, t.createdAt),
    index('photos_status_idx').on(t.status),
  ],
);

export const photoMetadata = pgTable(
  'photo_metadata',
  {
    id: primaryId(),
    photoId: text('photoId')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    cameraMake: text('cameraMake'),
    cameraModel: text('cameraModel'),
    lens: text('lens'),
    iso: integer('iso'),
    aperture: doublePrecision('aperture'),
    shutterSpeed: text('shutterSpeed'),
    focalLength: doublePrecision('focalLength'),
    orientation: integer('orientation'),
    exif: jsonb('exif'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('photo_metadata_photoId_key').on(t.photoId)],
);

export const faceRecords = pgTable(
  'face_records',
  {
    id: primaryId(),
    photoId: text('photoId')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    boundingBox: jsonb('boundingBox').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    embedding: text('embedding').notNull(), // AES-256-GCM encrypted descriptor
    embeddingModel: text('embeddingModel').notNull(),
    embeddingDim: integer('embeddingDim').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('face_records_eventId_idx').on(t.eventId),
    index('face_records_photoId_idx').on(t.photoId),
  ],
);

export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: primaryId(),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    status: guestSessionStatusEnum('status').notNull().default('CONSENTED'),
    consentAt: timestamp('consentAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    revokedAt: timestamp('revokedAt', { precision: 3, mode: 'date' }),
    selfieObjectKey: text('selfieObjectKey'),
    selfieDeletedAt: timestamp('selfieDeletedAt', { precision: 3, mode: 'date' }),
    lastSelfieAt: timestamp('lastSelfieAt', { precision: 3, mode: 'date' }),
    matchingStartedAt: timestamp('matchingStartedAt', { precision: 3, mode: 'date' }),
    matchingCompletedAt: timestamp('matchingCompletedAt', { precision: 3, mode: 'date' }),
    matchCount: integer('matchCount').notNull().default(0),
    matchThreshold: doublePrecision('matchThreshold'),
    errorCode: text('errorCode'),
    ipHash: text('ipHash'),
    userAgentHash: text('userAgentHash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('guest_sessions_eventId_createdAt_idx').on(t.eventId, t.createdAt),
    index('guest_sessions_expiresAt_idx').on(t.expiresAt),
    index('guest_sessions_status_idx').on(t.status),
  ],
);

export const guestConsents = pgTable(
  'guest_consents',
  {
    id: primaryId(),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    guestSessionId: text('guestSessionId').references(() => guestSessions.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    consentVersion: text('consentVersion').notNull(),
    consentTextHash: text('consentTextHash').notNull(),
    acceptedAt: timestamp('acceptedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawnAt', { precision: 3, mode: 'date' }),
    ipHash: text('ipHash'),
    userAgentHash: text('userAgentHash'),
  },
  (t) => [
    uniqueIndex('guest_consents_guestSessionId_key').on(t.guestSessionId),
    index('guest_consents_eventId_acceptedAt_idx').on(t.eventId, t.acceptedAt),
  ],
);

export const matchingResults = pgTable(
  'matching_results',
  {
    id: primaryId(),
    guestSessionId: text('guestSessionId')
      .notNull()
      .references(() => guestSessions.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    photoId: text('photoId')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    distance: doublePrecision('distance').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('matching_results_guestSessionId_photoId_key').on(
      t.guestSessionId,
      t.photoId,
    ),
    index('matching_results_eventId_idx').on(t.eventId),
    index('matching_results_guestSessionId_distance_idx').on(t.guestSessionId, t.distance),
  ],
);

export const favorites = pgTable(
  'favorites',
  {
    id: primaryId(),
    guestSessionId: text('guestSessionId')
      .notNull()
      .references(() => guestSessions.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    photoId: text('photoId')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('favorites_guestSessionId_photoId_key').on(t.guestSessionId, t.photoId),
  ],
);

export const downloads = pgTable(
  'downloads',
  {
    id: primaryId(),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    photoId: text('photoId').references(() => photos.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    guestSessionId: text('guestSessionId').references(() => guestSessions.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    userId: text('userId').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    kind: downloadKindEnum('kind').notNull().default('SINGLE'),
    format: text('format').notNull().default('original'),
    photoCount: integer('photoCount').notNull().default(1),
    bytes: doublePrecision('bytes').notNull().default(0),
    ipHash: text('ipHash'),
    createdAt: createdAt(),
  },
  (t) => [
    index('downloads_eventId_createdAt_idx').on(t.eventId, t.createdAt),
    index('downloads_guestSessionId_idx').on(t.guestSessionId),
  ],
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: primaryId(),
    tokenHash: text('tokenHash').notNull(),
    photoId: text('photoId')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    guestSessionId: text('guestSessionId').references(() => guestSessions.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    downloads: integer('downloads').notNull().default(0),
    revokedAt: timestamp('revokedAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('share_links_tokenHash_key').on(t.tokenHash),
    index('share_links_photoId_idx').on(t.photoId),
    index('share_links_expiresAt_idx').on(t.expiresAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// QR & storage
// ─────────────────────────────────────────────────────────────

export const qrCodes = pgTable(
  'qr_codes',
  {
    id: primaryId(),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    targetPath: text('targetPath').notNull(),
    scans: integer('scans').notNull().default(0),
    lastScanAt: timestamp('lastScanAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('qr_codes_eventId_key').on(t.eventId)],
);

export const qrScans = pgTable(
  'qr_scans',
  {
    id: primaryId(),
    qrCodeId: text('qrCodeId')
      .notNull()
      .references(() => qrCodes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: text('eventId')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dedupeKey: text('dedupeKey').notNull(),
    ipHash: text('ipHash'),
    userAgent: text('userAgent'),
    referrer: text('referrer'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('qr_scans_dedupeKey_key').on(t.dedupeKey),
    index('qr_scans_eventId_createdAt_idx').on(t.eventId, t.createdAt),
  ],
);

export const storageObjects = pgTable(
  'storage_objects',
  {
    id: primaryId(),
    studioId: text('studioId')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: text('eventId').references(() => events.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    photoId: text('photoId').references(() => photos.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    key: text('key').notNull(),
    kind: storageKindEnum('kind').notNull(),
    bytes: doublePrecision('bytes').notNull(),
    contentType: text('contentType').notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deletedAt', { precision: 3, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('storage_objects_key_key').on(t.key),
    index('storage_objects_studioId_kind_idx').on(t.studioId, t.kind),
    index('storage_objects_eventId_idx').on(t.eventId),
    index('storage_objects_deletedAt_idx').on(t.deletedAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Notifications, audit & platform
// ─────────────────────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    studioId: text('studioId')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text('userId').references(() => users.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    eventId: text('eventId').references(() => events.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    readAt: timestamp('readAt', { precision: 3, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_studioId_readAt_createdAt_idx').on(
      t.studioId,
      t.readAt,
      t.createdAt,
    ),
    index('notifications_userId_idx').on(t.userId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    studioId: text('studioId').references(() => studios.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    actorId: text('actorId').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entityId'),
    metadata: jsonb('metadata'),
    ipHash: text('ipHash'),
    userAgent: text('userAgent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_studioId_createdAt_idx').on(t.studioId, t.createdAt),
    index('audit_logs_actorId_idx').on(t.actorId),
    index('audit_logs_entity_entityId_idx').on(t.entity, t.entityId),
  ],
);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

// ─────────────────────────────────────────────────────────────
// Relations (used by the Drizzle relational query API)
// ─────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(studioMembers),
  ownedStudios: many(studios, { relationName: 'StudioOwner' }),
  sessions: many(userSessions),
  verificationTokens: many(verificationTokens),
  createdEvents: many(events, { relationName: 'EventCreatedBy' }),
  uploadedPhotos: many(photos, { relationName: 'PhotoUploadedBy' }),
  downloads: many(downloads),
  notifications: many(notifications),
  auditLogs: many(auditLogs, { relationName: 'AuditActor' }),
  sentInvites: many(studioInvites, { relationName: 'InviteSender' }),
}));

export const studiosRelations = relations(studios, ({ one, many }) => ({
  owner: one(users, {
    fields: [studios.ownerId],
    references: [users.id],
    relationName: 'StudioOwner',
  }),
  members: many(studioMembers),
  events: many(events),
  subscription: one(subscriptions),
  invoices: many(invoices),
  storage: many(storageObjects),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
  invites: many(studioInvites),
}));

export const studioMembersRelations = relations(studioMembers, ({ one }) => ({
  studio: one(studios, {
    fields: [studioMembers.studioId],
    references: [studios.id],
  }),
  user: one(users, {
    fields: [studioMembers.userId],
    references: [users.id],
  }),
}));

export const studioInvitesRelations = relations(studioInvites, ({ one }) => ({
  studio: one(studios, {
    fields: [studioInvites.studioId],
    references: [studios.id],
  }),
  invitedBy: one(users, {
    fields: [studioInvites.invitedById],
    references: [users.id],
    relationName: 'InviteSender',
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

export const verificationTokensRelations = relations(verificationTokens, ({ one }) => ({
  user: one(users, {
    fields: [verificationTokens.userId],
    references: [users.id],
  }),
}));

export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  studio: one(studios, {
    fields: [subscriptions.studioId],
    references: [studios.id],
  }),
  plan: one(plans, {
    fields: [subscriptions.planId],
    references: [plans.id],
  }),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
  studio: one(studios, {
    fields: [invoices.studioId],
    references: [studios.id],
  }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  studio: one(studios, {
    fields: [events.studioId],
    references: [studios.id],
  }),
  createdBy: one(users, {
    fields: [events.createdById],
    references: [users.id],
    relationName: 'EventCreatedBy',
  }),
  settings: one(eventSettings),
  photos: many(photos),
  faces: many(faceRecords),
  guestSessions: many(guestSessions),
  matchingResults: many(matchingResults),
  consents: many(guestConsents),
  downloads: many(downloads),
  qrCode: one(qrCodes),
  qrScans: many(qrScans),
  storage: many(storageObjects),
  notifications: many(notifications),
}));

export const eventSettingsRelations = relations(eventSettings, ({ one }) => ({
  event: one(events, {
    fields: [eventSettings.eventId],
    references: [events.id],
  }),
}));

export const photosRelations = relations(photos, ({ one, many }) => ({
  event: one(events, {
    fields: [photos.eventId],
    references: [events.id],
  }),
  uploadedBy: one(users, {
    fields: [photos.uploadedById],
    references: [users.id],
    relationName: 'PhotoUploadedBy',
  }),
  metadata: one(photoMetadata),
  faces: many(faceRecords),
  matchingResults: many(matchingResults),
  favorites: many(favorites),
  downloads: many(downloads),
  shareLinks: many(shareLinks),
  storage: many(storageObjects),
}));

export const photoMetadataRelations = relations(photoMetadata, ({ one }) => ({
  photo: one(photos, {
    fields: [photoMetadata.photoId],
    references: [photos.id],
  }),
}));

export const faceRecordsRelations = relations(faceRecords, ({ one }) => ({
  photo: one(photos, {
    fields: [faceRecords.photoId],
    references: [photos.id],
  }),
  event: one(events, {
    fields: [faceRecords.eventId],
    references: [events.id],
  }),
}));

export const guestSessionsRelations = relations(guestSessions, ({ one, many }) => ({
  event: one(events, {
    fields: [guestSessions.eventId],
    references: [events.id],
  }),
  consent: one(guestConsents),
  matchingResults: many(matchingResults),
  favorites: many(favorites),
  downloads: many(downloads),
  shareLinks: many(shareLinks),
}));

export const guestConsentsRelations = relations(guestConsents, ({ one }) => ({
  event: one(events, {
    fields: [guestConsents.eventId],
    references: [events.id],
  }),
  guestSession: one(guestSessions, {
    fields: [guestConsents.guestSessionId],
    references: [guestSessions.id],
  }),
}));

export const matchingResultsRelations = relations(matchingResults, ({ one }) => ({
  guestSession: one(guestSessions, {
    fields: [matchingResults.guestSessionId],
    references: [guestSessions.id],
  }),
  event: one(events, {
    fields: [matchingResults.eventId],
    references: [events.id],
  }),
  photo: one(photos, {
    fields: [matchingResults.photoId],
    references: [photos.id],
  }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  guestSession: one(guestSessions, {
    fields: [favorites.guestSessionId],
    references: [guestSessions.id],
  }),
  photo: one(photos, {
    fields: [favorites.photoId],
    references: [photos.id],
  }),
}));

export const downloadsRelations = relations(downloads, ({ one }) => ({
  event: one(events, {
    fields: [downloads.eventId],
    references: [events.id],
  }),
  photo: one(photos, {
    fields: [downloads.photoId],
    references: [photos.id],
  }),
  guestSession: one(guestSessions, {
    fields: [downloads.guestSessionId],
    references: [guestSessions.id],
  }),
  user: one(users, {
    fields: [downloads.userId],
    references: [users.id],
  }),
}));

export const shareLinksRelations = relations(shareLinks, ({ one }) => ({
  photo: one(photos, {
    fields: [shareLinks.photoId],
    references: [photos.id],
  }),
  guestSession: one(guestSessions, {
    fields: [shareLinks.guestSessionId],
    references: [guestSessions.id],
  }),
}));

export const qrCodesRelations = relations(qrCodes, ({ one, many }) => ({
  event: one(events, {
    fields: [qrCodes.eventId],
    references: [events.id],
  }),
  scans: many(qrScans),
}));

export const qrScansRelations = relations(qrScans, ({ one }) => ({
  qrCode: one(qrCodes, {
    fields: [qrScans.qrCodeId],
    references: [qrCodes.id],
  }),
  event: one(events, {
    fields: [qrScans.eventId],
    references: [events.id],
  }),
}));

export const storageObjectsRelations = relations(storageObjects, ({ one }) => ({
  studio: one(studios, {
    fields: [storageObjects.studioId],
    references: [studios.id],
  }),
  event: one(events, {
    fields: [storageObjects.eventId],
    references: [events.id],
  }),
  photo: one(photos, {
    fields: [storageObjects.photoId],
    references: [photos.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  studio: one(studios, {
    fields: [notifications.studioId],
    references: [studios.id],
  }),
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [notifications.eventId],
    references: [events.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  studio: one(studios, {
    fields: [auditLogs.studioId],
    references: [studios.id],
  }),
  actor: one(users, {
    fields: [auditLogs.actorId],
    references: [users.id],
    relationName: 'AuditActor',
  }),
}));
