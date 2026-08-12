import {
  BuildArtifactKind,
  ProjectStatus,
  ProjectType,
  ProtectionLevel,
  type SourceAnalysis,
} from '@janus/contracts';
import type { Prisma, PrismaClient } from '@janus/database';
import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '../../app.tokens';
import type {
  BuildRecord,
  ProfileRecord,
  ProjectRecord,
  ProjectRepository,
  SourceRecord,
} from '../domain/project.ports';

const projectInclude = {
  sources: { orderBy: { revision: 'desc' as const }, take: 1 },
} satisfies Prisma.ProjectInclude;

const buildInclude = { artifacts: true } satisfies Prisma.BuildInclude;
type ProjectWithSource = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

@Injectable()
export class PrismaProjectRepository implements ProjectRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async create(input: {
    organizationId: string;
    actorId: string;
    name: string;
    slug: string;
    description?: string;
  }): Promise<ProjectRecord> {
    const project = await this.prisma.$transaction(async (transaction) => {
      const created: ProjectWithSource = await transaction.project.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          slug: input.slug,
          ...(input.description === undefined ? {} : { description: input.description }),
          protection: { create: {} },
        },
        include: projectInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          organizationId: input.organizationId,
          action: 'PROJECT_CREATED',
          resourceType: 'Project',
          resourceId: created.id,
        },
      });
      return created;
    });
    return mapProject(project);
  }

  async list(organizationId: string): Promise<ProjectRecord[]> {
    const projects = await this.prisma.project.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: projectInclude,
      orderBy: { createdAt: 'desc' },
    });
    return projects.map(mapProject);
  }

  async find(organizationId: string, projectId: string): Promise<ProjectRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, status: 'ACTIVE' },
      include: projectInclude,
    });
    return project ? mapProject(project) : null;
  }

  async update(
    organizationId: string,
    projectId: string,
    input: { name?: string; slug?: string; description?: string | null },
  ): Promise<ProjectRecord | null> {
    const exists = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!exists) return null;
    return mapProject(
      await this.prisma.project.update({
        where: { id: projectId },
        data: input,
        include: projectInclude,
      }),
    );
  }

  async archive(organizationId: string, projectId: string, actorId: string): Promise<boolean> {
    const result = await this.prisma.project.updateMany({
      where: { id: projectId, organizationId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
    if (result.count === 0) return false;
    await this.prisma.auditLog.create({
      data: {
        actorId,
        organizationId,
        action: 'PROJECT_DELETED',
        resourceType: 'Project',
        resourceId: projectId,
      },
    });
    return true;
  }

  async nextSourceRevision(organizationId: string, projectId: string): Promise<number | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, status: 'ACTIVE' },
      select: { sources: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true } } },
    });
    if (!project) return null;
    return (project.sources[0]?.revision ?? 0) + 1;
  }

  async saveSource(input: {
    organizationId: string;
    actorId: string;
    projectId: string;
    revision: number;
    objectKey: string;
    sha256: string;
    size: number;
    analysis: SourceAnalysis;
  }): Promise<SourceRecord> {
    const source = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.projectSource.create({
        data: {
          projectId: input.projectId,
          revision: input.revision,
          originalObjectKey: input.objectKey,
          sha256: input.sha256,
          size: input.size,
          fileCount: input.analysis.fileCount,
          uncompressedSize: input.analysis.uncompressedSize,
          detectedType: input.analysis.type,
          rootDirectory: input.analysis.rootDirectory,
          analysis: input.analysis,
        },
      });
      await transaction.project.update({
        where: { id: input.projectId },
        data: { type: input.analysis.type },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          organizationId: input.organizationId,
          action: 'SOURCE_UPLOADED',
          resourceType: 'ProjectSource',
          resourceId: created.id,
          metadata: { revision: input.revision, sha256: input.sha256 },
        },
      });
      return created;
    });
    return mapSource(source);
  }

  async getProfile(organizationId: string, projectId: string): Promise<ProfileRecord | null> {
    const profile = await this.prisma.protectionProfile.findFirst({
      where: { projectId, project: { organizationId, status: 'ACTIVE' } },
    });
    return profile ? mapProfile(profile) : null;
  }

  async setProfile(
    organizationId: string,
    projectId: string,
    input: Omit<ProfileRecord, 'projectId' | 'updatedAt'>,
  ): Promise<ProfileRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!project) return null;
    return mapProfile(
      await this.prisma.protectionProfile.upsert({
        where: { projectId },
        create: { projectId, ...input },
        update: input,
      }),
    );
  }

  async createBuild(input: {
    organizationId: string;
    actorId: string;
    projectId: string;
    version: string;
    protectionLevel?: ProtectionLevel;
  }): Promise<BuildRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId, status: 'ACTIVE' },
      include: {
        sources: { orderBy: { revision: 'desc' }, take: 1 },
        protection: true,
      },
    });
    const source = project?.sources[0];
    if (!project || !source) return null;
    const profile = project.protection;
    const level = input.protectionLevel ?? mapProtectionLevel(profile?.level ?? 'BASIC');
    const build = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.build.create({
        data: {
          projectId: project.id,
          sourceId: source.id,
          version: input.version,
          protectionLevel: level,
          runtimeInjection: profile?.runtimeInjection ?? true,
          integrity: profile?.integrity ?? true,
          obfuscation: profile?.obfuscation ?? true,
          excludePaths: profile?.excludePaths ?? [],
        },
        include: buildInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          organizationId: input.organizationId,
          action: 'BUILD_CREATED',
          resourceType: 'Build',
          resourceId: created.id,
          metadata: { version: input.version, sourceRevision: source.revision },
        },
      });
      return created;
    });
    return mapBuild(build);
  }

  async findBuild(
    organizationId: string,
    projectId: string,
    buildId: string,
  ): Promise<BuildRecord | null> {
    const build = await this.prisma.build.findFirst({
      where: { id: buildId, projectId, project: { organizationId, status: 'ACTIVE' } },
      include: buildInclude,
    });
    return build ? mapBuild(build) : null;
  }

  async findArtifact(
    organizationId: string,
    projectId: string,
    buildId: string,
    artifactId: string,
  ): Promise<{ objectKey: string; contentType: string; version: string; kind: string } | null> {
    const artifact = await this.prisma.buildArtifact.findFirst({
      where: {
        id: artifactId,
        buildId,
        build: { projectId, project: { organizationId, status: 'ACTIVE' } },
      },
      include: { build: { select: { version: true } } },
    });
    return artifact
      ? {
          objectKey: artifact.objectKey,
          contentType: artifact.contentType,
          version: artifact.build.version,
          kind: artifact.kind,
        }
      : null;
  }
}

function mapProject(
  project: Prisma.ProjectGetPayload<{ include: typeof projectInclude }>,
): ProjectRecord {
  return {
    ...project,
    type: mapProjectType(project.type),
    status: project.status === 'ACTIVE' ? ProjectStatus.ACTIVE : ProjectStatus.ARCHIVED,
    latestSource: project.sources[0] ? mapSource(project.sources[0]) : null,
  };
}

function mapSource(source: {
  id: string;
  projectId: string;
  revision: number;
  originalObjectKey: string;
  sha256: string;
  size: number;
  fileCount: number;
  uncompressedSize: number;
  detectedType: string;
  rootDirectory: string;
  analysis: Prisma.JsonValue;
  createdAt: Date;
}): SourceRecord {
  return {
    ...source,
    detectedType: mapProjectType(source.detectedType),
    analysis: source.analysis as SourceAnalysis,
  };
}

function mapProfile(profile: {
  projectId: string;
  level: string;
  runtimeInjection: boolean;
  integrity: boolean;
  obfuscation: boolean;
  excludePaths: string[];
  updatedAt: Date;
}): ProfileRecord {
  return { ...profile, level: mapProtectionLevel(profile.level) };
}

function mapBuild(build: Prisma.BuildGetPayload<{ include: typeof buildInclude }>): BuildRecord {
  return {
    ...build,
    protectionLevel: mapProtectionLevel(build.protectionLevel),
    artifacts: build.artifacts.map((artifact) => ({
      ...artifact,
      kind: artifact.kind as BuildArtifactKind,
    })),
  };
}

function mapProjectType(type: string): ProjectType {
  if (type === 'PLUGIN') return ProjectType.PLUGIN;
  if (type === 'THEME') return ProjectType.THEME;
  return ProjectType.UNKNOWN;
}

function mapProtectionLevel(level: string): ProtectionLevel {
  if (level === 'STANDARD') return ProtectionLevel.STANDARD;
  if (level === 'STRONG') return ProtectionLevel.STRONG;
  return ProtectionLevel.BASIC;
}
