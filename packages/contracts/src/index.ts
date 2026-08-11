export enum UserStatus {
  UNVERIFIED = 'UNVERIFIED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DISABLED = 'DISABLED',
}

export enum OrganizationRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  DEVELOPER = 'DEVELOPER',
  VIEWER = 'VIEWER',
}

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

export type Account = {
  id: string;
  email: string;
  username: string;
  status: UserStatus;
  emailVerifiedAt: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    role: OrganizationRole;
  };
};

export type AuthTokens = {
  accessToken: string;
  accessTokenExpiresIn: number;
};

export type AuthResponse = AuthTokens & { account: Account };

export type MessageResponse = { message: string };
