import { SetMetadata } from '@nestjs/common';
import type { StudioRole } from '../../db/schema';

export const STUDIO_ROLES_KEY = 'studioRoles';
export const StudioRoles = (...roles: StudioRole[]) => SetMetadata(STUDIO_ROLES_KEY, roles);
