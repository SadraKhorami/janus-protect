import { randomUUID } from 'node:crypto';
import { SecureTokenService, type Clock, type PasswordHasher } from '@janus/auth-core';
import type { AppConfig } from '@janus/config';
import type { MessageResponse } from '@janus/contracts';
import type { ForgotPasswordInput, ResetPasswordInput } from '@janus/validation';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../app.tokens';
import { errors } from '../../common/errors/application-error';
import {
  AUDIT_SERVICE,
  AUTH_REPOSITORY,
  EMAIL_SERVICE,
  RATE_LIMITER,
  type AuditService,
  type AuthRepository,
  type EmailService,
  type RateLimiter,
} from '../domain/auth.ports';

@Injectable()
export class PasswordRecoveryService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject('PASSWORD_HASHER') private readonly passwordHasher: PasswordHasher,
    @Inject('SECURE_TOKEN_SERVICE') private readonly tokens: SecureTokenService,
    @Inject('CLOCK') private readonly clock: Clock,
  ) {}

  async forgotPassword(
    input: ForgotPasswordInput,
    context: { clientKey: string },
  ): Promise<MessageResponse> {
    await this.limiter.consume('auth:forgot', context.clientKey, 5, 3600);
    await this.limiter.consume('auth:forgot:email', input.email, 3, 3600);
    const user = await this.repository.findUserByEmail(input.email);
    if (user) {
      const now = this.clock.now();
      const id = randomUUID();
      const token = this.tokens.opaqueToken(id);
      await this.repository.createPasswordReset({
        id,
        userId: user.id,
        tokenHash: this.tokens.hash(token),
        expiresAt: new Date(now.getTime() + this.config.PASSWORD_RESET_TTL_SECONDS * 1000),
      });
      try {
        await this.email.sendPasswordReset({ to: user.email, username: user.username, token });
      } catch {
        await this.audit.record({
          actorId: user.id,
          action: 'PASSWORD_RESET_DELIVERY_FAILED',
          resourceType: 'User',
          resourceId: user.id,
        });
      }
    }
    return { message: 'If the account exists, password reset instructions will be sent.' };
  }

  async resetPassword(
    input: ResetPasswordInput,
    context: { clientKey: string; requestId?: string },
  ): Promise<MessageResponse> {
    await this.limiter.consume('auth:reset', context.clientKey, 10, 3600);
    if (input.password.length < this.config.PASSWORD_MIN_LENGTH) throw errors.invalidReset();
    const resetId = this.tokens.tokenId(input.token);
    if (!resetId) throw errors.invalidReset();
    const reset = await this.repository.findPasswordReset(resetId);
    const now = this.clock.now();
    if (
      !reset ||
      reset.usedAt ||
      reset.expiresAt <= now ||
      !this.tokens.matches(input.token, reset.tokenHash)
    ) {
      throw errors.invalidReset();
    }

    await this.repository.resetPassword({
      resetId: reset.id,
      userId: reset.userId,
      passwordHash: await this.passwordHasher.hash(input.password),
      usedAt: now,
    });
    await this.repository.revokeAllSessions(reset.userId, now);
    await this.audit.record({
      actorId: reset.userId,
      action: 'PASSWORD_CHANGED',
      resourceType: 'User',
      resourceId: reset.userId,
      requestId: context.requestId,
    });
    return { message: 'Password updated. Sign in with your new password.' };
  }
}
