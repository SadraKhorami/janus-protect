CREATE TYPE "ProjectType" AS ENUM ('UNKNOWN', 'PLUGIN', 'THEME');
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ProtectionLevel" AS ENUM ('BASIC', 'STANDARD', 'STRONG');
CREATE TYPE "BuildStatus" AS ENUM ('QUEUED', 'PREPARING', 'ANALYZING', 'INJECTING_RUNTIME', 'PROTECTING', 'GENERATING_INTEGRITY', 'VALIDATING', 'PACKAGING', 'UPLOADING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "BuildArtifactKind" AS ENUM ('ORIGINAL_SOURCE', 'PROTECTED_ZIP', 'ANALYSIS_REPORT', 'PROTECTION_REPORT', 'INTEGRITY_MANIFEST', 'BUILD_REPORT');

CREATE TABLE "Project" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "type" "ProjectType" NOT NULL DEFAULT 'UNKNOWN',
  "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectSource" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "originalObjectKey" VARCHAR(512) NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "size" INTEGER NOT NULL,
  "fileCount" INTEGER NOT NULL,
  "uncompressedSize" INTEGER NOT NULL,
  "detectedType" "ProjectType" NOT NULL,
  "rootDirectory" VARCHAR(255) NOT NULL,
  "analysis" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProtectionProfile" (
  "projectId" UUID NOT NULL,
  "level" "ProtectionLevel" NOT NULL DEFAULT 'BASIC',
  "runtimeInjection" BOOLEAN NOT NULL DEFAULT true,
  "integrity" BOOLEAN NOT NULL DEFAULT true,
  "obfuscation" BOOLEAN NOT NULL DEFAULT true,
  "excludePaths" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProtectionProfile_pkey" PRIMARY KEY ("projectId")
);

CREATE TABLE "Build" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "version" VARCHAR(32) NOT NULL,
  "protectionLevel" "ProtectionLevel" NOT NULL,
  "status" "BuildStatus" NOT NULL DEFAULT 'QUEUED',
  "errorCode" VARCHAR(100),
  "errorMessage" VARCHAR(1000),
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Build_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuildArtifact" (
  "id" UUID NOT NULL,
  "buildId" UUID NOT NULL,
  "kind" "BuildArtifactKind" NOT NULL,
  "objectKey" VARCHAR(512) NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "size" INTEGER NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuildArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Project_organizationId_slug_key" ON "Project"("organizationId", "slug");
CREATE INDEX "Project_organizationId_status_createdAt_idx" ON "Project"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "ProjectSource_originalObjectKey_key" ON "ProjectSource"("originalObjectKey");
CREATE UNIQUE INDEX "ProjectSource_projectId_revision_key" ON "ProjectSource"("projectId", "revision");
CREATE INDEX "ProjectSource_projectId_createdAt_idx" ON "ProjectSource"("projectId", "createdAt");
CREATE UNIQUE INDEX "Build_projectId_version_key" ON "Build"("projectId", "version");
CREATE INDEX "Build_projectId_status_createdAt_idx" ON "Build"("projectId", "status", "createdAt");
CREATE INDEX "Build_status_queuedAt_idx" ON "Build"("status", "queuedAt");
CREATE UNIQUE INDEX "BuildArtifact_objectKey_key" ON "BuildArtifact"("objectKey");
CREATE UNIQUE INDEX "BuildArtifact_buildId_kind_key" ON "BuildArtifact"("buildId", "kind");
CREATE INDEX "BuildArtifact_buildId_idx" ON "BuildArtifact"("buildId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSource" ADD CONSTRAINT "ProjectSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProtectionProfile" ADD CONSTRAINT "ProtectionProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Build" ADD CONSTRAINT "Build_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Build" ADD CONSTRAINT "Build_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProjectSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuildArtifact" ADD CONSTRAINT "BuildArtifact_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "Build"("id") ON DELETE CASCADE ON UPDATE CASCADE;
