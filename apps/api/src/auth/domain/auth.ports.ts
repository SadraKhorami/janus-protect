import type { Account } from '@janus/contracts';
import type {
  AccountRecord,
  PasswordResetRecord,
  SessionRecord,
  UserRecord,
  VerificationRecord,
} from './auth.models';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');
export const ACCESS_TOKEN_SERVICE = Symbol('ACCESS_TOKEN_SERVICE');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByIdentifier(identifier: string): Promise<UserRecord | null>;
  findAccount(userId: string): Promise<AccountRecord | null>;
  registerPersonalAccount(input: {
    email: string;
    username: string;
    passwordHash: string;
    organizationName: string;
    organizationSlug: string;
    verificationCodeHash: string;
    verificationExpiresAt: Date;
  }): Promise<UserRecord>;
  latestVerification(userId: string): Promise<VerificationRecord | null>;
  incrementVerificationAttempt(id: string): Promise<void>;
  replaceVerification(input: {
    id: string;
    codeHash: string;
    expiresAt: Date;
    sentAt: Date;
  }): Promise<void>;
  verifyEmail(userId: string, verificationId: string, verifiedAt: Date): Promise<void>;
  createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  findSession(id: string): Promise<SessionRecord | null>;
  rotateSession(
    id: string,
    expectedHash: string,
    replacementHash: string,
    usedAt: Date,
  ): Promise<boolean>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
  revokeAllSessions(userId: string, revokedAt: Date): Promise<void>;
  createPasswordReset(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findPasswordReset(id: string): Promise<PasswordResetRecord | null>;
  resetPassword(input: {
    resetId: string;
    userId: string;
    passwordHash: string;
    usedAt: Date;
  }): Promise<void>;
}

export interface EmailService {
  sendVerificationCode(input: { to: string; username: string; code: string }): Promise<void>;
  sendPasswordReset(input: { to: string; username: string; token: string }): Promise<void>;
}

export type AccessTokenClaims = {
  userId: string;
  sessionId: string;
  organizationId: string;
  role: string;
};

export interface AccessTokenService {
  issue(claims: AccessTokenClaims): Promise<string>;
  verify(token: string): Promise<AccessTokenClaims>;
}

export interface RateLimiter {
  consume(scope: string, subject: string, limit: number, windowSeconds: number): Promise<void>;
}

export interface AuditService {
  record(input: {
    actorId?: string | undefined;
    organizationId?: string | undefined;
    action: string;
    resourceType: string;
    resourceId?: string | undefined;
    requestId?: string | undefined;
    metadata?: Record<string, string | number | boolean | null> | undefined;
  }): Promise<void>;
}

export function serializeAccount(record: AccountRecord): Account {
  return {
    id: record.id,
    email: record.email,
    username: record.username,
    status: record.status,
    emailVerifiedAt: record.emailVerifiedAt?.toISOString() ?? null,
    organization: record.organization,
  };
}
