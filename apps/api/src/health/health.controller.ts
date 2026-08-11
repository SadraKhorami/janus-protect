import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@janus/database';
import type IORedis from 'ioredis';
import type { S3StorageHealth } from '@janus/storage';
import { PRISMA, REDIS, STORAGE_HEALTH } from '../app.tokens';
import { ApplicationError } from '../common/errors/application-error';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(STORAGE_HEALTH) private readonly storage: S3StorageHealth,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'PostgreSQL, Redis, and object storage readiness probe' })
  async ready(): Promise<{ status: 'ok'; dependencies: Record<string, 'ok'> }> {
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping(), this.storage.check()]);
      return { status: 'ok', dependencies: { postgres: 'ok', redis: 'ok', objectStorage: 'ok' } };
    } catch {
      throw new ApplicationError('NOT_READY', 'One or more dependencies are unavailable.', 503);
    }
  }
}
