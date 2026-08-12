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

export enum ProjectType {
  UNKNOWN = 'UNKNOWN',
  PLUGIN = 'PLUGIN',
  THEME = 'THEME',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum ProtectionLevel {
  BASIC = 'BASIC',
  STANDARD = 'STANDARD',
  STRONG = 'STRONG',
}

export enum BuildStatus {
  QUEUED = 'QUEUED',
  PREPARING = 'PREPARING',
  ANALYZING = 'ANALYZING',
  INJECTING_RUNTIME = 'INJECTING_RUNTIME',
  PROTECTING = 'PROTECTING',
  GENERATING_INTEGRITY = 'GENERATING_INTEGRITY',
  VALIDATING = 'VALIDATING',
  PACKAGING = 'PACKAGING',
  UPLOADING = 'UPLOADING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum BuildArtifactKind {
  ORIGINAL_SOURCE = 'ORIGINAL_SOURCE',
  PROTECTED_ZIP = 'PROTECTED_ZIP',
  ANALYSIS_REPORT = 'ANALYSIS_REPORT',
  PROTECTION_REPORT = 'PROTECTION_REPORT',
  INTEGRITY_MANIFEST = 'INTEGRITY_MANIFEST',
  BUILD_REPORT = 'BUILD_REPORT',
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

export type SourceAnalysis = {
  type: ProjectType;
  rootDirectory: string;
  entryFile: string;
  fileCount: number;
  phpFileCount: number;
  uncompressedSize: number;
  nestedArchives: number;
};

export type ProjectSource = {
  id: string;
  revision: number;
  sha256: string;
  size: number;
  analysis: SourceAnalysis;
  createdAt: string;
};

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  type: ProjectType;
  status: ProjectStatus;
  description: string | null;
  latestSource: ProjectSource | null;
  createdAt: string;
  updatedAt: string;
};

export type ProtectionProfile = {
  projectId: string;
  level: ProtectionLevel;
  runtimeInjection: boolean;
  integrity: boolean;
  obfuscation: boolean;
  excludePaths: string[];
  updatedAt: string;
};

export type BuildArtifact = {
  id: string;
  kind: BuildArtifactKind;
  sha256: string;
  size: number;
  contentType: string;
  downloadPath: string;
};

export type Build = {
  id: string;
  projectId: string;
  sourceId: string;
  version: string;
  protectionLevel: ProtectionLevel;
  protection: {
    level: ProtectionLevel;
    runtimeInjection: boolean;
    integrity: boolean;
    obfuscation: boolean;
    excludePaths: string[];
  };
  status: BuildStatus;
  errorCode: string | null;
  errorMessage: string | null;
  artifacts: BuildArtifact[];
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type License = {
  id: string;
  projectId: string;
  keyPrefix: string;
  customerEmail: string | null;
  maxActivations: number;
  activeActivations: number;
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: string | null;
  createdAt: string;
};

export type IssuedLicense = License & { key: string };

export type LicenseLease = {
  payload: string;
  signature: string;
};

export type LicenseActivationResult = {
  valid: true;
  activationToken: string;
  lease: LicenseLease;
  expiresAt: string | null;
};
