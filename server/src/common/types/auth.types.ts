import type { StudioRole, UserRole } from '../../db/schema';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
  emailVerifiedAt: Date | null;
  sessionId?: string;
}

export interface StudioContext {
  id: string;
  name: string;
  slug: string;
  role: StudioRole;
  membershipId: string;
  storageUsedBytes: number;
}

export interface GuestContext {
  id: string;
  eventId: string;
  status: string;
  expiresAt: Date;
  consentAt: Date;
}

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
  role: UserRole;
  sid?: string;
}

export interface GuestTokenPayload {
  sub: string;
  typ: 'guest';
  eventId: string;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
