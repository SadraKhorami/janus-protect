import { createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';
import type {
  IssuedLicense,
  License,
  LicenseActivationResult,
  LicenseLease,
} from '@janus/contracts';
import type { AppConfig } from '@janus/config';
import type { PrismaClient } from '@janus/database';
import type {
  ActivateLicenseInput,
  CreateLicenseInput,
  ValidateLicenseInput,
} from '@janus/validation';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, PRISMA } from '../app.tokens';
import { RATE_LIMITER, type RateLimiter } from '../auth/domain/auth.ports';
import { errors } from '../common/errors/application-error';

const LEASE_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class LicensingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async create(
    organizationId: string,
    actorId: string,
    role: string,
    projectId: string,
    input: CreateLicenseInput,
  ): Promise<IssuedLicense> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!project) throw errors.notFound('Project');
    if (role === 'VIEWER' && (await this.prisma.license.count({ where: { projectId } })) >= 1) {
      throw errors.viewerQuota('license');
    }
    const key = licenseKey();
    const created = await this.prisma.$transaction(async (tx) => {
      const license = await tx.license.create({
        data: {
          projectId,
          keyHash: this.hash(key),
          keyPrefix: key.slice(0, 12),
          customerEmail: input.customerEmail ?? null,
          maxActivations: input.maxActivations,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
        include: { activations: { where: { deactivatedAt: null }, select: { id: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          organizationId,
          action: 'LICENSE_CREATED',
          resourceType: 'License',
          resourceId: license.id,
          metadata: { projectId, maxActivations: input.maxActivations },
        },
      });
      return license;
    });
    return { ...mapLicense(created), key };
  }

  async list(organizationId: string, projectId: string): Promise<License[]> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!project) throw errors.notFound('Project');
    return (
      await this.prisma.license.findMany({
        where: { projectId },
        include: { activations: { where: { deactivatedAt: null }, select: { id: true } } },
        orderBy: { createdAt: 'desc' },
      })
    ).map(mapLicense);
  }

  async revoke(
    organizationId: string,
    actorId: string,
    projectId: string,
    licenseId: string,
  ): Promise<License> {
    const existing = await this.prisma.license.findFirst({
      where: { id: licenseId, projectId, project: { organizationId, status: 'ACTIVE' } },
    });
    if (!existing) throw errors.notFound('License');
    const updated = await this.prisma.$transaction(async (tx) => {
      const license = await tx.license.update({
        where: { id: licenseId },
        data: { status: 'REVOKED' },
        include: { activations: { where: { deactivatedAt: null }, select: { id: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          organizationId,
          action: 'LICENSE_REVOKED',
          resourceType: 'License',
          resourceId: licenseId,
        },
      });
      return license;
    });
    return mapLicense(updated);
  }

  async activate(input: ActivateLicenseInput, clientKey: string): Promise<LicenseActivationResult> {
    await this.limiter.consume('license:activate', clientKey, 30, 900);
    const site = normalizeSite(input.siteUrl);
    const siteHash = this.hash(site.binding);
    const now = new Date();
    const token = randomBytes(32).toString('base64url');
    const result = await this.prisma.$transaction(
      async (tx) => {
        const license = await tx.license.findFirst({
          where: { projectId: input.projectId, keyHash: this.hash(input.key) },
          include: { activations: true },
        });
        assertUsable(license, now);
        const existing = license.activations.find((item) => item.siteHash === siteHash);
        const activeCount = license.activations.filter(
          (item) => item.deactivatedAt === null,
        ).length;
        if ((!existing || existing.deactivatedAt) && activeCount >= license.maxActivations)
          throw errors.activationLimit();
        const activation = existing
          ? await tx.licenseActivation.update({
              where: { id: existing.id },
              data: {
                siteUrl: site.display,
                tokenHash: this.hash(token),
                deactivatedAt: null,
                lastValidatedAt: now,
              },
            })
          : await tx.licenseActivation.create({
              data: {
                licenseId: license.id,
                siteUrl: site.display,
                siteHash,
                tokenHash: this.hash(token),
              },
            });
        return { license, activation };
      },
      { isolationLevel: 'Serializable' },
    );
    return {
      valid: true,
      activationToken: token,
      lease: this.lease(result.license, result.activation, site.binding),
      expiresAt: result.license.expiresAt?.toISOString() ?? null,
    };
  }

  async validate(input: ValidateLicenseInput, clientKey: string): Promise<LicenseActivationResult> {
    await this.limiter.consume('license:validate', clientKey, 120, 900);
    const site = normalizeSite(input.siteUrl);
    const activation = await this.prisma.licenseActivation.findFirst({
      where: {
        tokenHash: this.hash(input.activationToken),
        siteHash: this.hash(site.binding),
        deactivatedAt: null,
        license: { projectId: input.projectId },
      },
      include: { license: true },
    });
    if (!activation) throw errors.licenseInvalid();
    assertUsable(activation.license, new Date());
    await this.prisma.licenseActivation.update({
      where: { id: activation.id },
      data: { lastValidatedAt: new Date() },
    });
    return {
      valid: true,
      activationToken: input.activationToken,
      lease: this.lease(activation.license, activation, site.binding),
      expiresAt: activation.license.expiresAt?.toISOString() ?? null,
    };
  }

  async deactivate(input: ValidateLicenseInput, clientKey: string): Promise<void> {
    await this.limiter.consume('license:deactivate', clientKey, 30, 900);
    const site = normalizeSite(input.siteUrl);
    await this.prisma.licenseActivation.updateMany({
      where: {
        tokenHash: this.hash(input.activationToken),
        siteHash: this.hash(site.binding),
        deactivatedAt: null,
        license: { projectId: input.projectId },
      },
      data: { deactivatedAt: new Date() },
    });
  }

  private hash(value: string): string {
    return createHmac('sha256', this.config.TOKEN_HASH_SECRET).update(value).digest('hex');
  }

  private lease(
    license: { id: string; projectId: string; expiresAt: Date | null },
    activation: { id: string },
    site: string,
  ): LicenseLease {
    const now = Math.floor(Date.now() / 1000);
    const licenseExpiry = license.expiresAt ? Math.floor(license.expiresAt.getTime() / 1000) : null;
    const payloadRaw = JSON.stringify({
      v: 1,
      projectId: license.projectId,
      licenseId: license.id,
      activationId: activation.id,
      site,
      iat: now,
      exp: Math.min(now + LEASE_SECONDS, licenseExpiry ?? Number.MAX_SAFE_INTEGER),
    });
    const privateKey = createPrivateKey({
      key: Buffer.from(this.config.BUILD_SIGNING_PRIVATE_KEY, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    return {
      payload: Buffer.from(payloadRaw).toString('base64url'),
      signature: sign(null, Buffer.from(payloadRaw), privateKey).toString('base64'),
    };
  }
}

function licenseKey(): string {
  return `JP-${
    randomBytes(18)
      .toString('hex')
      .toUpperCase()
      .match(/.{1,6}/g)
      ?.join('-') ?? ''
  }`;
}

function normalizeSite(value: string): { binding: string; display: string } {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw errors.licenseInvalid();
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw errors.licenseInvalid();
  const port = url.port ? `:${url.port}` : '';
  return { binding: `${host}${port}`, display: `${url.protocol}//${host}${port}` };
}

function assertUsable<T extends { status: string; expiresAt: Date | null }>(
  license: T | null,
  now: Date,
): asserts license is T {
  if (!license || license.status !== 'ACTIVE' || (license.expiresAt && license.expiresAt <= now))
    throw errors.licenseInvalid();
}

function mapLicense(value: {
  id: string;
  projectId: string;
  keyPrefix: string;
  customerEmail: string | null;
  maxActivations: number;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  activations: Array<{ id: string }>;
}): License {
  return {
    id: value.id,
    projectId: value.projectId,
    keyPrefix: value.keyPrefix,
    customerEmail: value.customerEmail,
    maxActivations: value.maxActivations,
    activeActivations: value.activations.length,
    status: value.status as License['status'],
    expiresAt: value.expiresAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
  };
}
