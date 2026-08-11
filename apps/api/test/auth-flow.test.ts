import { SecureTokenService, type PasswordHasher } from '@janus/auth-core';
import type { AppConfig } from '@janus/config';
import { OrganizationRole, UserStatus } from '@janus/contracts';
import { describe, expect, it } from 'vitest';
import { PasswordRecoveryService } from '../src/auth/application/password-recovery.service';
import { RegistrationService } from '../src/auth/application/registration.service';
import { SessionService } from '../src/auth/application/session.service';
import type {
  AccountRecord,
  PasswordResetRecord,
  SessionRecord,
  UserRecord,
  VerificationRecord,
} from '../src/auth/domain/auth.models';
import type {
  AccessTokenClaims,
  AccessTokenService,
  AuditService,
  AuthRepository,
  EmailService,
  RateLimiter,
} from '../src/auth/domain/auth.ports';

const config = {
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  EMAIL_VERIFICATION_TTL_SECONDS: 900,
  PASSWORD_RESET_TTL_SECONDS: 1800,
  PASSWORD_MIN_LENGTH: 12,
} as AppConfig;

class FastPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `hash:${password}`;
  }
  async verify(hash: string, password: string): Promise<boolean> {
    return hash === `hash:${password}`;
  }
}

class InMemoryEmail implements EmailService {
  verificationCode?: string;
  resetToken?: string;
  async sendVerificationCode(input: { code: string }): Promise<void> {
    this.verificationCode = input.code;
  }
  async sendPasswordReset(input: { token: string }): Promise<void> {
    this.resetToken = input.token;
  }
}

class InMemoryRepository implements AuthRepository {
  user?: UserRecord;
  account?: AccountRecord;
  verification?: VerificationRecord;
  reset?: PasswordResetRecord;
  sessions = new Map<string, SessionRecord>();

  async findUserByEmail(email: string) {
    return this.user?.email === email ? this.user : null;
  }
  async findUserByIdentifier(identifier: string) {
    return this.user && [this.user.email, this.user.username].includes(identifier)
      ? this.user
      : null;
  }
  async findAccount(userId: string) {
    return this.account?.id === userId ? this.account : null;
  }
  async registerPersonalAccount(input: {
    email: string;
    username: string;
    passwordHash: string;
    organizationName: string;
    organizationSlug: string;
    verificationCodeHash: string;
    verificationExpiresAt: Date;
  }) {
    this.user = {
      id: 'user-1',
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      status: UserStatus.UNVERIFIED,
      emailVerifiedAt: null,
    };
    this.account = {
      ...this.user,
      organization: {
        id: 'org-1',
        name: input.organizationName,
        slug: input.organizationSlug,
        role: OrganizationRole.OWNER,
      },
    };
    this.verification = {
      id: 'verification-1',
      userId: this.user.id,
      codeHash: input.verificationCodeHash,
      expiresAt: input.verificationExpiresAt,
      attemptCount: 0,
      resendCount: 0,
      lastSentAt: new Date(),
      usedAt: null,
    };
    return this.user;
  }
  async latestVerification() {
    return this.verification ?? null;
  }
  async incrementVerificationAttempt() {
    if (this.verification) this.verification.attemptCount += 1;
  }
  async replaceVerification(input: { codeHash: string; expiresAt: Date; sentAt: Date }) {
    if (this.verification) {
      this.verification.codeHash = input.codeHash;
      this.verification.expiresAt = input.expiresAt;
      this.verification.lastSentAt = input.sentAt;
      this.verification.resendCount += 1;
    }
  }
  async verifyEmail(_userId: string, _verificationId: string, verifiedAt: Date) {
    if (this.user && this.account && this.verification) {
      this.user.status = UserStatus.ACTIVE;
      this.user.emailVerifiedAt = verifiedAt;
      this.account.status = UserStatus.ACTIVE;
      this.account.emailVerifiedAt = verifiedAt;
      this.verification.usedAt = verifiedAt;
    }
  }
  async createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }) {
    const session = { ...input, revokedAt: null };
    this.sessions.set(input.id, session);
    return session;
  }
  async findSession(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async rotateSession(id: string, expectedHash: string, replacementHash: string) {
    const session = this.sessions.get(id);
    if (!session || session.refreshTokenHash !== expectedHash) return false;
    session.refreshTokenHash = replacementHash;
    return true;
  }
  async revokeSession(id: string, revokedAt: Date) {
    const session = this.sessions.get(id);
    if (session) session.revokedAt = revokedAt;
  }
  async revokeAllSessions(userId: string, revokedAt: Date) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) session.revokedAt = revokedAt;
    }
  }
  async createPasswordReset(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    this.reset = { ...input, usedAt: null };
  }
  async findPasswordReset(id: string) {
    return this.reset?.id === id ? this.reset : null;
  }
  async resetPassword(input: {
    resetId: string;
    userId: string;
    passwordHash: string;
    usedAt: Date;
  }) {
    if (this.user && this.reset) {
      this.user.passwordHash = input.passwordHash;
      this.reset.usedAt = input.usedAt;
    }
  }
}

const noLimits: RateLimiter = { consume: async () => undefined };
const noAudit: AuditService = { record: async () => undefined };
const accessTokens: AccessTokenService = {
  issue: async (claims) => JSON.stringify(claims),
  verify: async (token) => JSON.parse(token) as AccessTokenClaims,
};

describe('authentication application flow', () => {
  it('registers, verifies, logs in, rotates refresh tokens, and resets the password', async () => {
    const repository = new InMemoryRepository();
    const email = new InMemoryEmail();
    const passwordHasher = new FastPasswordHasher();
    const tokens = new SecureTokenService('test-token-secret-with-at-least-32-characters');
    const clock = { now: () => new Date('2026-08-11T10:00:00.000Z') };
    const registration = new RegistrationService(
      repository,
      email,
      noLimits,
      noAudit,
      config,
      passwordHasher,
      tokens,
      clock,
    );
    const sessions = new SessionService(
      repository,
      accessTokens,
      noLimits,
      noAudit,
      config,
      passwordHasher,
      tokens,
      clock,
    );
    const recovery = new PasswordRecoveryService(
      repository,
      email,
      noLimits,
      noAudit,
      config,
      passwordHasher,
      tokens,
      clock,
    );

    await registration.register(
      { email: 'owner@example.com', username: 'owner', password: 'original password value' },
      { clientKey: 'client' },
    );
    expect(repository.user?.status).toBe(UserStatus.UNVERIFIED);
    expect(email.verificationCode).toMatch(/^\d{6}$/);

    await registration.verifyEmail(
      { email: 'owner@example.com', code: email.verificationCode ?? '' },
      { clientKey: 'client' },
    );
    expect(repository.user?.status).toBe(UserStatus.ACTIVE);

    const login = await sessions.login(
      { identifier: 'owner', password: 'original password value' },
      { clientKey: 'client', userAgent: 'test', requestId: 'request-1' },
    );
    const refresh = await sessions.refresh(login.refreshToken, 'client');
    expect(refresh.refreshToken).not.toBe(login.refreshToken);
    await expect(sessions.refresh(login.refreshToken, 'client')).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });

    await recovery.forgotPassword({ email: 'owner@example.com' }, { clientKey: 'client' });
    await recovery.resetPassword(
      { token: email.resetToken ?? '', password: 'replacement password value' },
      { clientKey: 'client' },
    );
    expect(repository.user?.passwordHash).toBe('hash:replacement password value');
    expect([...repository.sessions.values()].every((session) => session.revokedAt)).toBe(true);
  });
});
