import { getConfig, type AppConfig } from '@janus/config';
import { createPrismaClient, type PrismaClient } from '@janus/database';
import { createLogger } from '@janus/logger';
import { createRedisConnection } from '@janus/queue';
import { S3StorageHealth } from '@janus/storage';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type IORedis from 'ioredis';
import type { Logger } from 'pino';
import { APP_CONFIG, APP_LOGGER, PRISMA, REDIS, STORAGE_HEALTH } from './app.tokens';

class ResourceShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(STORAGE_HEALTH) private readonly storage: S3StorageHealth,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.storage.destroy();
    this.redis.disconnect(false);
    await this.prisma.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: getConfig },
    {
      provide: APP_LOGGER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Logger => createLogger(config.NODE_ENV),
    },
    {
      provide: PRISMA,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPrismaClient(config.DATABASE_URL),
    },
    {
      provide: REDIS,
      inject: [APP_CONFIG, APP_LOGGER],
      useFactory: (config: AppConfig, logger: Logger) => {
        const redis = createRedisConnection(config.REDIS_URL);
        redis.on('error', (error) => logger.warn({ err: error }, 'Redis connection error'));
        return redis;
      },
    },
    {
      provide: STORAGE_HEALTH,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new S3StorageHealth({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          bucket: config.S3_BUCKET,
          accessKeyId: config.S3_ACCESS_KEY,
          secretAccessKey: config.S3_SECRET_KEY,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        }),
    },
    ResourceShutdown,
  ],
  exports: [APP_CONFIG, APP_LOGGER, PRISMA, REDIS, STORAGE_HEALTH],
})
export class InfrastructureModule {}
