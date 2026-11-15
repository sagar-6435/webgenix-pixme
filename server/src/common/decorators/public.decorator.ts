import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without a photographer JWT. Guest routes that
 * still need a session use `GuestSessionGuard` explicitly.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
