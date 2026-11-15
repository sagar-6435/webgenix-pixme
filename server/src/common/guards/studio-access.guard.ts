import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { StudioRole, StudioStatus, UserStatus, studioMembers, studios } from '../../db/schema';
import { STUDIO_ROLES_KEY } from '../decorators/studio-roles.decorator';
import type { AuthUser, StudioContext } from '../types/auth.types';

/**
 * Resolves the active studio for every tenant-scoped request. The studio comes
 * from X-Studio-Id (validated against membership) or the user's first studio.
 * Services additionally scope every query by this studio id.
 */
@Injectable()
export class StudioAccessGuard implements CanActivate {
  constructor(
    private readonly database: DrizzleService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Authentication required');
    }

    const requestedStudioId =
      (request.headers['x-studio-id'] as string | undefined) ??
      (request.query?.studioId as string | undefined);

    const membership = await this.database.db.query.studioMembers.findFirst({
      where: and(
        eq(studioMembers.userId, user.id),
        requestedStudioId ? eq(studioMembers.studioId, requestedStudioId) : undefined,
        inArray(
          studioMembers.studioId,
          this.database.db
            .select({ id: studios.id })
            .from(studios)
            .where(eq(studios.status, StudioStatus.ACTIVE)),
        ),
      ),
      with: { studio: true },
      orderBy: asc(studioMembers.createdAt),
    });

    if (!membership) {
      throw new ForbiddenException('No accessible studio for this account');
    }

    const role = membership.role;
    const required = this.reflector.getAllAndOverride<StudioRole[]>(STUDIO_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.includes(role)) {
      throw new ForbiddenException('Your studio role cannot perform this action');
    }

    const studio: StudioContext = {
      id: membership.studio.id,
      name: membership.studio.name,
      slug: membership.studio.slug,
      role,
      membershipId: membership.id,
      storageUsedBytes: membership.studio.storageUsedBytes,
    };
    request.studio = studio;
    return true;
  }
}
