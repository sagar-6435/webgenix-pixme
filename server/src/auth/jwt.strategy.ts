import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { eq } from 'drizzle-orm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DrizzleService } from '../db/drizzle.service';
import { UserStatus, users } from '../db/schema';
import type { AccessTokenPayload, AuthUser } from '../common/types/auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly database: DrizzleService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    if (!payload?.sub || payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid session');
    }
    const [user] = await this.database.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('This account is not active');
    }
    return { ...user, sessionId: payload.sid };
  }
}
