import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export class ArgonPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}

export class SecureTokenService {
  constructor(private readonly hashSecret: string) {}

  verificationCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  opaqueToken(id: string): string {
    return `${id}.${randomBytes(32).toString('base64url')}`;
  }

  hash(value: string): string {
    return createHmac('sha256', this.hashSecret).update(value, 'utf8').digest('base64url');
  }

  matches(value: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(value));
    const expected = Buffer.from(expectedHash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  tokenId(token: string): string | null {
    const separator = token.indexOf('.');
    return separator > 0 ? token.slice(0, separator) : null;
  }
}
