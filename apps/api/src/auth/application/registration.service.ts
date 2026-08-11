import { randomUUID } from 'node:crypto';
import { SecureTokenService, type Clock, type PasswordHasher } from '@janus/auth-core';
import { UserStatus } from '@janus/contracts';
import type { AppConfig } from '@janus/config';
import type { MessageResponse } from '@janus/contracts';
import type { RegisterInput, ResendVerificationInput, VerifyEmailInput } from '@janus/validation';
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

const verificationResponse: MessageResponse = {
  message: 'If the account can be verified, a verification code will be sent.',
};

@Injectable()
export class RegistrationService {
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

  async register(
    input: RegisterInput,
    context: { clientKey: string; requestId?: string },
  ): Promise<MessageResponse> {
    await this.limiter.consume('auth:register', context.clientKey, 5, 900);
    await this.limiter.consume('auth:register:email', input.email, 3, 3600);
    if (input.password.length < this.config.PASSWORD_MIN_LENGTH) {
      throw errors.invalidCredentials();
    }

    const existing = await this.repository.findUserByEmail(input.email);
    if (existing) throw errors.conflict();

    const now = this.clock.now();
    const code = this.tokens.verificationCode();
    const passwordHash = await this.passwordHasher.hash(input.password);
    const suffix = randomUUID().slice(0, 8);
    const user = await this.repository.registerPersonalAccount({
      email: input.email,
      username: input.username,
      passwordHash,
      organizationName: `${input.username}'s workspace`,
      organizationSlug: `${input.username}-${suffix}`,
      verificationCodeHash: this.tokens.hash(code),
      verificationExpiresAt: new Date(
        now.getTime() + this.config.EMAIL_VERIFICATION_TTL_SECONDS * 1000,
      ),
    });

    await this.audit.record({
      actorId: user.id,
      action: 'USER_REGISTERED',
      resourceType: 'User',
      resourceId: user.id,
      requestId: context.requestId,
    });
    try {
      await this.email.sendVerificationCode({ to: user.email, username: user.username, code });
    } catch {
      await this.audit.record({
        actorId: user.id,
        action: 'EMAIL_VERIFICATION_DELIVERY_FAILED',
        resourceType: 'User',
        resourceId: user.id,
      });
    }
    return { message: 'Registration accepted. Check your email for the verification code.' };
  }

  async verifyEmail(
    input: VerifyEmailInput,
    context: { clientKey: string; requestId?: string },
  ): Promise<MessageResponse> {
    await this.limiter.consume('auth:verify', context.clientKey, 15, 900);
    await this.limiter.consume('auth:verify:email', input.email, 10, 900);
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.status !== UserStatus.UNVERIFIED) throw errors.invalidVerification();

    const verification = await this.repository.latestVerification(user.id);
    const now = this.clock.now();
    if (!verification || verification.usedAt || verification.expiresAt <= now) {
      throw errors.invalidVerification();
    }
    if (verification.attemptCount >= 5) throw errors.verificationAttempts();

    if (!this.tokens.matches(input.code, verification.codeHash)) {
      await this.repository.incrementVerificationAttempt(verification.id);
      throw errors.invalidVerification();
    }

    await this.repository.verifyEmail(user.id, verification.id, now);
    await this.audit.record({
      actorId: user.id,
      action: 'EMAIL_VERIFIED',
      resourceType: 'User',
      resourceId: user.id,
      requestId: context.requestId,
    });
    return { message: 'Email verified. You can now sign in.' };
  }

  async resendVerification(
    input: ResendVerificationInput,
    context: { clientKey: string },
  ): Promise<MessageResponse> {
    await this.limiter.consume('auth:resend', context.clientKey, 5, 3600);
    await this.limiter.consume('auth:resend:email', input.email, 5, 3600);
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.status !== UserStatus.UNVERIFIED) return verificationResponse;

    const verification = await this.repository.latestVerification(user.id);
    const now = this.clock.now();
    if (!verification) return verificationResponse;
    if (verification.resendCount >= 5) return verificationResponse;
    if (now.getTime() - verification.lastSentAt.getTime() < 60_000) return verificationResponse;

    const code = this.tokens.verificationCode();
    await this.repository.replaceVerification({
      id: verification.id,
      codeHash: this.tokens.hash(code),
      expiresAt: new Date(now.getTime() + this.config.EMAIL_VERIFICATION_TTL_SECONDS * 1000),
      sentAt: now,
    });
    try {
      await this.email.sendVerificationCode({ to: user.email, username: user.username, code });
    } catch {
      await this.audit.record({
        actorId: user.id,
        action: 'EMAIL_VERIFICATION_DELIVERY_FAILED',
        resourceType: 'User',
        resourceId: user.id,
      });
    }
    return verificationResponse;
  }
}
