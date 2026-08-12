CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "License" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "keyPrefix" VARCHAR(16) NOT NULL,
    "customerEmail" VARCHAR(254),
    "maxActivations" INTEGER NOT NULL DEFAULT 1,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LicenseActivation" (
    "id" UUID NOT NULL,
    "licenseId" UUID NOT NULL,
    "siteUrl" VARCHAR(512) NOT NULL,
    "siteHash" CHAR(64) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    CONSTRAINT "LicenseActivation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "License_keyHash_key" ON "License"("keyHash");
CREATE INDEX "License_projectId_status_createdAt_idx" ON "License"("projectId", "status", "createdAt");
CREATE UNIQUE INDEX "LicenseActivation_tokenHash_key" ON "LicenseActivation"("tokenHash");
CREATE UNIQUE INDEX "LicenseActivation_licenseId_siteHash_key" ON "LicenseActivation"("licenseId", "siteHash");
CREATE INDEX "LicenseActivation_licenseId_deactivatedAt_idx" ON "LicenseActivation"("licenseId", "deactivatedAt");
ALTER TABLE "License" ADD CONSTRAINT "License_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LicenseActivation" ADD CONSTRAINT "LicenseActivation_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE CASCADE ON UPDATE CASCADE;
