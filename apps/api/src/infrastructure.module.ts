import { getConfig, type AppConfig } from '@janus/config';
import { createPrismaClient, type PrismaClient } from '@janus/database';
import { createLogger } from '@janus/logger';
import { createQueue, createRedisConnection, queueNames } from '@janus/queue';
import { S3ObjectStorage, S3StorageHealth, type ObjectStorage } from '@janus/storage';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import type { Logger } from 'pino';
import {
  APP_CONFIG,
  APP_LOGGER,
  BUILD_QUEUE,
  OBJECT_STORAGE,
  PRISMA,
  REDIS,
  STORAGE_HEALTH,
} from './app.tokens';

class ResourceShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(STORAGE_HEALTH) private readonly storage: S3StorageHealth,
    @Inject(OBJECT_STORAGE) private readonly objects: ObjectStorage,
    @Inject(BUILD_QUEUE) private readonly builds: Queue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.storage.destroy();
    this.objects.destroy();
    await this.builds.close();
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
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new S3ObjectStorage({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          bucket: config.S3_BUCKET,
          accessKeyId: config.S3_ACCESS_KEY,
          secretAccessKey: config.S3_SECRET_KEY,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        }),
    },
    {
      provide: BUILD_QUEUE,
      inject: [REDIS],
      useFactory: (redis: IORedis) => createQueue(queueNames.builds, redis),
    },
    ResourceShutdown,
  ],
  exports: [APP_CONFIG, APP_LOGGER, PRISMA, REDIS, STORAGE_HEALTH, OBJECT_STORAGE, BUILD_QUEUE],
})
export class InfrastructureModule {}
