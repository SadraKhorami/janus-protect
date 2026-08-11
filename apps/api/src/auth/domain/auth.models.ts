import type { OrganizationRole, UserStatus } from '@janus/contracts';

export type UserRecord = {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
};

export type AccountRecord = UserRecord & {
  organization: {
    id: string;
    name: string;
    slug: string;
    role: OrganizationRole;
  };
};

export type VerificationRecord = {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  attemptCount: number;
  resendCount: number;
  lastSentAt: Date;
  usedAt: Date | null;
};

export type SessionRecord = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type PasswordResetRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};
