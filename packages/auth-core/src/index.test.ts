import { describe, expect, it } from 'vitest';
import { ArgonPasswordHasher, SecureTokenService } from './index';

describe('SecureTokenService', () => {
  const service = new SecureTokenService('test-secret-that-is-at-least-32-characters');

  it('creates zero-padded six digit verification codes', () => {
    expect(service.verificationCode()).toMatch(/^\d{6}$/);
  });

  it('hashes and compares tokens without storing the raw value', () => {
    const token = service.opaqueToken('session-id');
    const hash = service.hash(token);
    expect(hash).not.toContain(token);
    expect(service.matches(token, hash)).toBe(true);
    expect(service.tokenId(token)).toBe('session-id');
  });
});

describe('ArgonPasswordHasher', () => {
  it('uses Argon2id and verifies without exposing the password', async () => {
    const hasher = new ArgonPasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).toContain('$argon2id$');
    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong password')).resolves.toBe(false);
  });
});
