import { ArgonPasswordHasher, SecureTokenService, systemClock } from '@janus/auth-core';
import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../app.tokens';
import { PasswordRecoveryService } from './application/password-recovery.service';
import { RegistrationService } from './application/registration.service';
import { SessionService } from './application/session.service';
import {
  ACCESS_TOKEN_SERVICE,
  AUDIT_SERVICE,
  AUTH_REPOSITORY,
  EMAIL_SERVICE,
  RATE_LIMITER,
} from './domain/auth.ports';
import { JoseAccessTokenService } from './infrastructure/jose-access-token.service';
import { PrismaAuditService } from './infrastructure/prisma-audit.service';
import { PrismaAuthRepository } from './infrastructure/prisma-auth.repository';
import { RedisRateLimiter } from './infrastructure/redis-rate-limiter';
import { SmtpEmailService } from './infrastructure/smtp-email.service';
import { AccessTokenGuard } from './presentation/access-token.guard';
import { AuthController } from './presentation/auth.controller';

@Module({
  controllers: [AuthController],
  providers: [
    RegistrationService,
    SessionService,
    PasswordRecoveryService,
    AccessTokenGuard,
    { provide: AUTH_REPOSITORY, useClass: PrismaAuthRepository },
    { provide: EMAIL_SERVICE, useClass: SmtpEmailService },
    { provide: ACCESS_TOKEN_SERVICE, useClass: JoseAccessTokenService },
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
    { provide: AUDIT_SERVICE, useClass: PrismaAuditService },
    { provide: 'PASSWORD_HASHER', useFactory: () => new ArgonPasswordHasher() },
    {
      provide: 'SECURE_TOKEN_SERVICE',
      inject: [APP_CONFIG],
      useFactory: (config: { TOKEN_HASH_SECRET: string }) =>
        new SecureTokenService(config.TOKEN_HASH_SECRET),
    },
    { provide: 'CLOCK', useValue: systemClock },
  ],
  exports: [AccessTokenGuard, ACCESS_TOKEN_SERVICE, RATE_LIMITER],
})
export class AuthModule {}
