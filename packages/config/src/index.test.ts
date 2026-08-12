import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigForTests } from './index';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/janus',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'janus-artifacts',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  SMTP_HOST: 'localhost',
  SMTP_FROM: 'no-reply@example.com',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  TOKEN_HASH_SECRET: 'b'.repeat(32),
  BUILD_SIGNING_PRIVATE_KEY: 'c'.repeat(48),
};

afterEach(() => resetConfigForTests());

describe('environment configuration', () => {
  it('uses safe development defaults after validating required secrets', () => {
    Object.assign(process.env, validEnvironment);
    expect(getConfig()).toMatchObject({ API_PORT: 4000, ACCESS_TOKEN_TTL_SECONDS: 900 });
  });
});
