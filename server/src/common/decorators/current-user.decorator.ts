import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser, GuestContext, StudioContext } from '../types/auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);

export const CurrentStudio = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StudioContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.studio as StudioContext;
  },
);

export const CurrentGuest = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GuestContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.guestSession as GuestContext;
  },
);
