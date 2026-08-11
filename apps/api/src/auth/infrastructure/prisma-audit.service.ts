import type { Prisma, PrismaClient } from '@janus/database';
import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '../../app.tokens';
import type { AuditService } from '../domain/auth.ports';

@Injectable()
export class PrismaAuditService implements AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async record(input: {
    actorId?: string | undefined;
    organizationId?: string | undefined;
    action: string;
    resourceType: string;
    resourceId?: string | undefined;
    requestId?: string | undefined;
    metadata?: Record<string, string | number | boolean | null> | undefined;
  }): Promise<void> {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: input.action,
      resourceType: input.resourceType,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
    };
    await this.prisma.auditLog.create({
      data,
    });
  }
}
