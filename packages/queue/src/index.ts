import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export const queueNames = {
  builds: 'builds',
  telemetry: 'telemetry-processing',
  risk: 'risk-analysis',
  emails: 'emails',
  notifications: 'notifications',
  releases: 'release-publishing',
  cleanup: 'cleanup',
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
};

export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function createQueue(name: QueueName, connection: IORedis): Queue {
  return new Queue(name, { connection, defaultJobOptions });
}
