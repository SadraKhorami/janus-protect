import type {
  BuildArtifactKind,
  ProjectStatus,
  ProjectType,
  ProtectionLevel,
  SourceAnalysis,
} from '@janus/contracts';

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export type ProjectRecord = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  type: ProjectType;
  status: ProjectStatus;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  latestSource: SourceRecord | null;
};

export type SourceRecord = {
  id: string;
  projectId: string;
  revision: number;
  originalObjectKey: string;
  sha256: string;
  size: number;
  fileCount: number;
  uncompressedSize: number;
  detectedType: ProjectType;
  rootDirectory: string;
  analysis: SourceAnalysis;
  createdAt: Date;
};

export type ProfileRecord = {
  projectId: string;
  level: ProtectionLevel;
  runtimeInjection: boolean;
  integrity: boolean;
  obfuscation: boolean;
  excludePaths: string[];
  updatedAt: Date;
};

export type BuildRecord = {
  id: string;
  projectId: string;
  sourceId: string;
  version: string;
  protectionLevel: ProtectionLevel;
  runtimeInjection: boolean;
  integrity: boolean;
  obfuscation: boolean;
  excludePaths: string[];
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  artifacts: Array<{
    id: string;
    kind: BuildArtifactKind;
    objectKey: string;
    sha256: string;
    size: number;
    contentType: string;
  }>;
};

export interface ProjectRepository {
  create(input: {
    organizationId: string;
    actorId: string;
    name: string;
    slug: string;
    description?: string;
  }): Promise<ProjectRecord>;
  list(organizationId: string): Promise<ProjectRecord[]>;
  find(organizationId: string, projectId: string): Promise<ProjectRecord | null>;
  update(
    organizationId: string,
    projectId: string,
    input: { name?: string; slug?: string; description?: string | null },
  ): Promise<ProjectRecord | null>;
  archive(organizationId: string, projectId: string, actorId: string): Promise<boolean>;
  nextSourceRevision(organizationId: string, projectId: string): Promise<number | null>;
  saveSource(input: {
    organizationId: string;
    actorId: string;
    projectId: string;
    revision: number;
    objectKey: string;
    sha256: string;
    size: number;
    analysis: SourceAnalysis;
  }): Promise<SourceRecord>;
  getProfile(organizationId: string, projectId: string): Promise<ProfileRecord | null>;
  setProfile(
    organizationId: string,
    projectId: string,
    input: Omit<ProfileRecord, 'projectId' | 'updatedAt'>,
  ): Promise<ProfileRecord | null>;
  createBuild(input: {
    organizationId: string;
    actorId: string;
    projectId: string;
    version: string;
    protectionLevel?: ProtectionLevel;
  }): Promise<BuildRecord | null>;
  findBuild(
    organizationId: string,
    projectId: string,
    buildId: string,
  ): Promise<BuildRecord | null>;
  findArtifact(
    organizationId: string,
    projectId: string,
    buildId: string,
    artifactId: string,
  ): Promise<{ objectKey: string; contentType: string; version: string; kind: string } | null>;
}
