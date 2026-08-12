import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { getConfig } from '@janus/config';
import { BuildArtifactKind, BuildStatus, ProtectionLevel } from '@janus/contracts';
import { createPrismaClient, type PrismaClient } from '@janus/database';
import { createLogger } from '@janus/logger';
import {
  BasicProtectionEngine,
  inspectWordPressArchive,
  matchesExcludedPath,
  sha256,
  stableJson,
  type ArchiveFile,
} from '@janus/protection-core';
import { createRedisConnection, queueNames } from '@janus/queue';
import { S3ObjectStorage } from '@janus/storage';
import { Worker, type Job } from 'bullmq';

const config = getConfig();
const logger = createLogger(config.NODE_ENV);
const prisma = createPrismaClient(config.DATABASE_URL);
const redis = createRedisConnection(config.REDIS_URL);
const storage = new S3ObjectStorage({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  bucket: config.S3_BUCKET,
  accessKeyId: config.S3_ACCESS_KEY,
  secretAccessKey: config.S3_SECRET_KEY,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
});
const transformer = resolve(process.cwd(), '../../services/php-transformer/bin/transform.php');

const worker = new Worker<{ buildId: string }>(
  queueNames.builds,
  async (job) => processBuild(job, prisma),
  { connection: redis, concurrency: 1, lockDuration: 120_000 },
);

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Build completed'));
worker.on('failed', (job, error) =>
  logger.error({ jobId: job?.id, err: error }, 'Build job failed'),
);
logger.info({ queue: queueNames.builds }, 'Build worker started');

async function processBuild(job: Job<{ buildId: string }>, database: PrismaClient): Promise<void> {
  const build = await database.build.findUnique({
    where: { id: job.data.buildId },
    include: { source: true, project: true },
  });
  if (!build || build.status !== 'QUEUED') return;
  try {
    await status(database, build.id, BuildStatus.PREPARING, { startedAt: new Date() });
    const original = await storage.get(build.source.originalObjectKey);
    await status(database, build.id, BuildStatus.ANALYZING);
    const inspected = await inspectWordPressArchive(original);
    await status(database, build.id, BuildStatus.INJECTING_RUNTIME);
    const engine = new BasicProtectionEngine();
    await status(database, build.id, BuildStatus.PROTECTING);
    const result = await engine.protect({
      files: inspected.files,
      analysis: inspected.analysis,
      level: mapLevel(build.protectionLevel),
      version: build.version,
      signingPrivateKey: config.BUILD_SIGNING_PRIVATE_KEY,
      runtimeInjection: build.runtimeInjection,
      integrity: build.integrity,
      obfuscation: build.obfuscation,
      transformPhp: (files) =>
        transformPhp(files, inspected.analysis.rootDirectory, true, build.excludePaths),
    });
    await status(database, build.id, BuildStatus.VALIDATING);
    const protectedInspection = await inspectWordPressArchive(result.archive);
    const validation = await transformPhp(
      protectedInspection.files,
      protectedInspection.analysis.rootDirectory,
      false,
      build.excludePaths,
    );
    const analysis = validation.report.analysis as { parseErrors?: unknown[] };
    if ((analysis.parseErrors?.length ?? 0) > 0) {
      throw new Error('Protected PHP failed AST validation.');
    }
    await status(database, build.id, BuildStatus.PACKAGING);

    const artifacts = [
      artifact(build.id, BuildArtifactKind.ORIGINAL_SOURCE, original, 'application/zip'),
      artifact(build.id, BuildArtifactKind.PROTECTED_ZIP, result.archive, 'application/zip'),
      artifact(
        build.id,
        BuildArtifactKind.ANALYSIS_REPORT,
        Buffer.from(stableJson(result.analysisReport)),
        'application/json',
      ),
      artifact(
        build.id,
        BuildArtifactKind.PROTECTION_REPORT,
        Buffer.from(stableJson(result.protectionReport)),
        'application/json',
      ),
      artifact(
        build.id,
        BuildArtifactKind.INTEGRITY_MANIFEST,
        Buffer.from(stableJson(result.integrityManifest)),
        'application/json',
      ),
      artifact(
        build.id,
        BuildArtifactKind.BUILD_REPORT,
        Buffer.from(stableJson(result.buildReport)),
        'application/json',
      ),
    ];
    await status(database, build.id, BuildStatus.UPLOADING);
    for (const item of artifacts) {
      item.objectKey = `organizations/${build.project.organizationId}/projects/${build.projectId}/builds/${build.id}/${item.kind.toLowerCase()}.${item.contentType === 'application/zip' ? 'zip' : 'json'}`;
      await storage.put(item.objectKey, item.data, item.contentType);
    }
    await database.$transaction(async (transaction) => {
      await transaction.buildArtifact.createMany({
        data: artifacts.map((item) => ({
          buildId: item.buildId,
          kind: item.kind,
          objectKey: item.objectKey,
          sha256: item.sha256,
          size: item.size,
          contentType: item.contentType,
        })),
      });
      await transaction.build.update({
        where: { id: build.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: build.project.organizationId,
          action: 'BUILD_COMPLETED',
          resourceType: 'Build',
          resourceId: build.id,
          metadata: { version: build.version, protectedSha256: sha256(result.archive) },
        },
      });
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : 'Unknown build failure.';
    await database.build.update({
      where: { id: build.id },
      data: {
        status: 'FAILED',
        errorCode: 'BUILD_PROCESSING_FAILED',
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

function transformPhp(
  files: ArchiveFile[],
  root: string,
  applyTransformation = true,
  excludePaths: string[] = [],
): Promise<{ files: ArchiveFile[]; report: Record<string, unknown> }> {
  const candidates = files.filter(
    (file) =>
      file.path.toLowerCase().endsWith('.php') &&
      !relative(file.path, root).startsWith('vendor/') &&
      !relative(file.path, root).startsWith('tests/') &&
      !matchesExcludedPath(relative(file.path, root), excludePaths),
  );
  const payload = JSON.stringify({
    files: candidates.map((file) => ({ path: file.path, content: file.data.toString('base64') })),
  });
  const stdout = execFileSync('php', [transformer], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 150 * 1024 * 1024,
    timeout: 120_000,
  });
  const output = JSON.parse(stdout) as {
    files: Array<{ path: string; content: string }>;
    analysis: Record<string, unknown>;
  };
  const transformed = new Map(
    output.files.map((file) => [file.path, Buffer.from(file.content, 'base64')]),
  );
  return Promise.resolve({
    files: files.map((file) => ({
      ...file,
      data: applyTransformation ? (transformed.get(file.path) ?? file.data) : file.data,
    })),
    report: {
      transformer: 'nikic/php-parser + PHP tokenizer',
      transformedFiles: applyTransformation ? transformed.size : 0,
      excludedFiles:
        files.filter((file) => file.path.toLowerCase().endsWith('.php')).length - candidates.length,
      requestedExclusions: excludePaths,
      analysis: output.analysis,
    },
  });
}

async function status(
  database: PrismaClient,
  buildId: string,
  next: BuildStatus,
  extra: { startedAt?: Date } = {},
): Promise<void> {
  await database.build.update({ where: { id: buildId }, data: { status: next, ...extra } });
}

function artifact(buildId: string, kind: BuildArtifactKind, data: Buffer, contentType: string) {
  return {
    buildId,
    kind,
    objectKey: '',
    sha256: sha256(data),
    size: data.length,
    contentType,
    data,
  };
}

function relative(filePath: string, root: string): string {
  return filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
}

function mapLevel(level: string): ProtectionLevel {
  if (level === 'STANDARD') return ProtectionLevel.STANDARD;
  if (level === 'STRONG') return ProtectionLevel.STRONG;
  return ProtectionLevel.BASIC;
}

async function shutdown(): Promise<void> {
  await worker.close();
  storage.destroy();
  redis.disconnect(false);
  await prisma.$disconnect();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
