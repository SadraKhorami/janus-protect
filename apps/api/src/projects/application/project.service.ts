import { randomUUID } from 'node:crypto';
import type {
  Build,
  Project,
  ProjectSource,
  ProtectionProfile,
  ProtectionLevel,
} from '@janus/contracts';
import { ArchiveValidationError, inspectWordPressArchive, sha256 } from '@janus/protection-core';
import type { ObjectStorage } from '@janus/storage';
import type {
  CreateBuildInput,
  CreateProjectInput,
  ProtectionProfileInput,
  UpdateProjectInput,
} from '@janus/validation';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BUILD_QUEUE, OBJECT_STORAGE } from '../../app.tokens';
import { errors } from '../../common/errors/application-error';
import {
  PROJECT_REPOSITORY,
  type BuildRecord,
  type ProfileRecord,
  type ProjectRecord,
  type ProjectRepository,
  type SourceRecord,
} from '../domain/project.ports';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repository: ProjectRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(BUILD_QUEUE) private readonly builds: Queue,
  ) {}

  async create(
    auth: { userId: string; organizationId: string },
    input: CreateProjectInput,
  ): Promise<Project> {
    try {
      return mapProject(
        await this.repository.create({
          organizationId: auth.organizationId,
          actorId: auth.userId,
          name: input.name,
          slug: input.slug,
          ...(input.description === undefined ? {} : { description: input.description }),
        }),
      );
    } catch (error) {
      if (isUniqueConstraint(error)) throw errors.projectConflict();
      throw error;
    }
  }

  async list(organizationId: string): Promise<Project[]> {
    return (await this.repository.list(organizationId)).map(mapProject);
  }

  async get(organizationId: string, projectId: string): Promise<Project> {
    const project = await this.repository.find(organizationId, projectId);
    if (!project) throw errors.notFound('Project');
    return mapProject(project);
  }

  async update(
    organizationId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<Project> {
    try {
      const project = await this.repository.update(organizationId, projectId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.description === undefined ? {} : { description: input.description }),
      });
      if (!project) throw errors.notFound('Project');
      return mapProject(project);
    } catch (error) {
      if (isUniqueConstraint(error)) throw errors.projectConflict();
      throw error;
    }
  }

  async archive(
    auth: { userId: string; organizationId: string },
    projectId: string,
  ): Promise<void> {
    if (!(await this.repository.archive(auth.organizationId, projectId, auth.userId))) {
      throw errors.notFound('Project');
    }
  }

  async uploadSource(
    auth: { userId: string; organizationId: string },
    projectId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
  ): Promise<ProjectSource> {
    if (!file) throw errors.archiveInvalid('ARCHIVE_REQUIRED', 'A ZIP file is required.');
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw errors.archiveInvalid('ARCHIVE_EXTENSION_INVALID', 'Only ZIP files are accepted.');
    }
    let inspected;
    try {
      inspected = await inspectWordPressArchive(file.buffer);
    } catch (error) {
      if (error instanceof ArchiveValidationError) {
        throw errors.archiveInvalid(error.code, error.message);
      }
      throw error;
    }
    const revision = await this.repository.nextSourceRevision(auth.organizationId, projectId);
    if (revision === null) throw errors.notFound('Project');
    const objectKey = `organizations/${auth.organizationId}/projects/${projectId}/sources/${randomUUID()}/original.zip`;
    await this.storage.put(objectKey, file.buffer, 'application/zip');
    return mapSource(
      await this.repository.saveSource({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        projectId,
        revision,
        objectKey,
        sha256: sha256(file.buffer),
        size: file.size,
        analysis: inspected.analysis,
      }),
    );
  }

  async getProtection(organizationId: string, projectId: string): Promise<ProtectionProfile> {
    const profile = await this.repository.getProfile(organizationId, projectId);
    if (!profile) throw errors.notFound('Project');
    return mapProfile(profile);
  }

  async setProtection(
    organizationId: string,
    projectId: string,
    input: ProtectionProfileInput,
  ): Promise<ProtectionProfile> {
    const profile = await this.repository.setProfile(organizationId, projectId, {
      ...input,
      level: input.level as ProtectionLevel,
    });
    if (!profile) throw errors.notFound('Project');
    return mapProfile(profile);
  }

  async createBuild(
    auth: { userId: string; organizationId: string },
    projectId: string,
    input: CreateBuildInput,
  ): Promise<Build> {
    try {
      const build = await this.repository.createBuild({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        projectId,
        version: input.version,
        ...(input.protectionLevel === undefined
          ? {}
          : { protectionLevel: input.protectionLevel as ProtectionLevel }),
      });
      if (!build) {
        const project = await this.repository.find(auth.organizationId, projectId);
        if (!project) throw errors.notFound('Project');
        throw errors.sourceRequired();
      }
      await this.builds.add('protect', { buildId: build.id }, { jobId: build.id });
      return mapBuild(build);
    } catch (error) {
      if (isUniqueConstraint(error)) throw errors.buildConflict();
      throw error;
    }
  }

  async getBuild(organizationId: string, projectId: string, buildId: string): Promise<Build> {
    const build = await this.repository.findBuild(organizationId, projectId, buildId);
    if (!build) throw errors.notFound('Build');
    return mapBuild(build);
  }

  async downloadArtifact(
    organizationId: string,
    projectId: string,
    buildId: string,
    artifactId: string,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const artifact = await this.repository.findArtifact(
      organizationId,
      projectId,
      buildId,
      artifactId,
    );
    if (!artifact) throw errors.notFound('Artifact');
    const extension = artifact.contentType === 'application/zip' ? 'zip' : 'json';
    return {
      body: await this.storage.get(artifact.objectKey),
      contentType: artifact.contentType,
      filename: `janus-${artifact.kind.toLowerCase()}-${artifact.version}.${extension}`,
    };
  }
}

function mapProject(project: ProjectRecord): Project {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    type: project.type,
    status: project.status,
    description: project.description,
    latestSource: project.latestSource ? mapSource(project.latestSource) : null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function mapSource(source: SourceRecord): ProjectSource {
  return {
    id: source.id,
    revision: source.revision,
    sha256: source.sha256,
    size: source.size,
    analysis: source.analysis,
    createdAt: source.createdAt.toISOString(),
  };
}

function mapProfile(profile: ProfileRecord): ProtectionProfile {
  return {
    ...profile,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function mapBuild(build: BuildRecord): Build {
  return {
    id: build.id,
    projectId: build.projectId,
    sourceId: build.sourceId,
    version: build.version,
    protectionLevel: build.protectionLevel,
    protection: {
      level: build.protectionLevel,
      runtimeInjection: build.runtimeInjection,
      integrity: build.integrity,
      obfuscation: build.obfuscation,
      excludePaths: build.excludePaths,
    },
    status: build.status as Build['status'],
    errorCode: build.errorCode,
    errorMessage: build.errorMessage,
    artifacts: build.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      sha256: artifact.sha256,
      size: artifact.size,
      contentType: artifact.contentType,
      downloadPath: `/api/v1/projects/${build.projectId}/builds/${build.id}/artifacts/${artifact.id}`,
    })),
    queuedAt: build.queuedAt.toISOString(),
    startedAt: build.startedAt?.toISOString() ?? null,
    completedAt: build.completedAt?.toISOString() ?? null,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
