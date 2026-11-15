import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import type { AuthUser, StudioContext } from '../common/types/auth.types';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(request.method)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const user = (request as Request & { user?: AuthUser }).user;
        const studio = (request as Request & { studio?: StudioContext }).studio;
        const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
        const segments = request.path.split('/').filter(Boolean);
        const entity = segments[segments.length - 1]?.replace(/[^a-z0-9-]/gi, '') || 'request';

        if (routePath.includes('/selfie')) return;

        void this.audit.record({
          studioId: studio?.id ?? null,
          actorId: user?.id ?? null,
          action: `${request.method} ${routePath}`,
          entity,
          entityId:
            (request.params as Record<string, string | undefined>)?.id ??
            (request.params as Record<string, string | undefined>)?.eventId ??
            null,
          metadata: { query: request.query, status: request.method === 'DELETE' ? 200 : 201 },
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });
      }),
    );
  }
}
