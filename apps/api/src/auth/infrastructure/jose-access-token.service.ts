import type { AppConfig } from '@janus/config';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG } from '../../app.tokens';
import { errors } from '../../common/errors/application-error';
import type { AccessTokenClaims, AccessTokenService } from '../domain/auth.ports';

@Injectable()
export class JoseAccessTokenService implements AccessTokenService {
  private readonly secret: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async issue(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({
      sid: claims.sessionId,
      org: claims.organizationId,
      role: claims.role,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer('janus-protect')
      .setAudience('janus-api')
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: 'janus-protect',
        audience: 'janus-api',
      });
      if (
        !payload.sub ||
        typeof payload.sid !== 'string' ||
        typeof payload.org !== 'string' ||
        typeof payload.role !== 'string'
      ) {
        throw errors.unauthorized();
      }
      return {
        userId: payload.sub,
        sessionId: payload.sid,
        organizationId: payload.org,
        role: payload.role,
      };
    } catch {
      throw errors.unauthorized();
    }
  }
}
