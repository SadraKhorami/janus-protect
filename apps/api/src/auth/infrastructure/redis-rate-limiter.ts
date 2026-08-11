import { SecureTokenService } from '@janus/auth-core';
import { Inject, Injectable } from '@nestjs/common';
import type IORedis from 'ioredis';
import { REDIS } from '../../app.tokens';
import { errors } from '../../common/errors/application-error';
import type { RateLimiter } from '../domain/auth.ports';

const fixedWindowScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject('SECURE_TOKEN_SERVICE') private readonly tokens: SecureTokenService,
  ) {}

  async consume(
    scope: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    try {
      const key = `rate-limit:${scope}:${this.tokens.hash(subject)}`;
      const result = (await this.redis.eval(
        fixedWindowScript,
        1,
        key,
        windowSeconds.toString(),
      )) as [number, number];
      if (result[0] > limit) throw errors.rateLimited(Math.max(result[1], 1));
    } catch (error) {
      if (error instanceof Error && error.name === 'ApplicationError') throw error;
      throw errors.serviceUnavailable();
    }
  }
}
