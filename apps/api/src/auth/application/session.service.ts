import { randomUUID } from 'node:crypto';
import { SecureTokenService, type Clock, type PasswordHasher } from '@janus/auth-core';
import type { AppConfig } from '@janus/config';
import { UserStatus, type Account, type AuthResponse } from '@janus/contracts';
import type { LoginInput } from '@janus/validation';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../app.tokens';
import { errors } from '../../common/errors/application-error';
import {
  ACCESS_TOKEN_SERVICE,
  AUDIT_SERVICE,
  AUTH_REPOSITORY,
  RATE_LIMITER,
  serializeAccount,
  type AccessTokenService,
  type AuditService,
  type AuthRepository,
  type RateLimiter,
} from '../domain/auth.ports';

export type LoginResult = AuthResponse & { refreshToken: string };

@Injectable()
export class SessionService {
  private readonly dummyPasswordHash: Promise<string>;

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly accessTokens: AccessTokenService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject('PASSWORD_HASHER') private readonly passwordHasher: PasswordHasher,
    @Inject('SECURE_TOKEN_SERVICE') private readonly tokens: SecureTokenService,
    @Inject('CLOCK') private readonly clock: Clock,
  ) {
    this.dummyPasswordHash = passwordHasher.hash('timing-only-password-value');
  }

  async login(
    input: LoginInput,
    context: { clientKey: string; userAgent: string | null; requestId?: string },
  ): Promise<LoginResult> {
    const identifier = input.identifier.trim().toLowerCase();
    await this.limiter.consume('auth:login', context.clientKey, 10, 900);
    await this.limiter.consume('auth:login:identifier', identifier, 10, 900);

    const user = await this.repository.findUserByIdentifier(identifier);
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordValid = await this.passwordHasher.verify(passwordHash, input.password);
    if (!user || !passwordValid) throw errors.invalidCredentials();
    if (user.status === UserStatus.UNVERIFIED) throw errors.emailNotVerified();
    if (user.status !== UserStatus.ACTIVE) throw errors.accountUnavailable();

    const account = await this.requireAccount(user.id);
    const now = this.clock.now();
    const sessionId = randomUUID();
    const refreshToken = this.tokens.opaqueToken(sessionId);
    await this.repository.createSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: this.tokens.hash(refreshToken),
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      expiresAt: new Date(now.getTime() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    const accessToken = await this.issueAccessToken(account, sessionId);
    await this.audit.record({
      actorId: user.id,
      organizationId: account.organization.id,
      action: 'LOGIN_SUCCESS',
      resourceType: 'AuthSession',
      resourceId: sessionId,
      requestId: context.requestId,
    });

    return {
      account: serializeAccount(account),
      accessToken,
      accessTokenExpiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }

  async refresh(refreshToken: string | undefined, clientKey: string): Promise<LoginResult> {
    await this.limiter.consume('auth:refresh', clientKey, 30, 900);
    if (!refreshToken) throw errors.invalidSession();
    const sessionId = this.tokens.tokenId(refreshToken);
    if (!sessionId) throw errors.invalidSession();
    const session = await this.repository.findSession(sessionId);
    const now = this.clock.now();
    if (!session || session.revokedAt || session.expiresAt <= now) throw errors.invalidSession();

    if (!this.tokens.matches(refreshToken, session.refreshTokenHash)) {
      await this.repository.revokeSession(session.id, now);
      throw errors.invalidSession();
    }

    const replacement = this.tokens.opaqueToken(session.id);
    const rotated = await this.repository.rotateSession(
      session.id,
      session.refreshTokenHash,
      this.tokens.hash(replacement),
      now,
    );
    if (!rotated) throw errors.invalidSession();

    const account = await this.requireAccount(session.userId);
    if (account.status !== UserStatus.ACTIVE) {
      await this.repository.revokeSession(session.id, now);
      throw errors.accountUnavailable();
    }

    return {
      account: serializeAccount(account),
      accessToken: await this.issueAccessToken(account, session.id),
      accessTokenExpiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: replacement,
    };
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.repository.revokeSession(sessionId, this.clock.now());
  }

  async me(userId: string): Promise<Account> {
    return serializeAccount(await this.requireAccount(userId));
  }

  private async issueAccessToken(
    account: Awaited<ReturnType<SessionService['requireAccount']>>,
    sessionId: string,
  ) {
    return this.accessTokens.issue({
      userId: account.id,
      sessionId,
      organizationId: account.organization.id,
      role: account.organization.role,
    });
  }

  private async requireAccount(userId: string) {
    const account = await this.repository.findAccount(userId);
    if (!account) throw errors.invalidSession();
    return account;
  }
}
