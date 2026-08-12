import { describe, expect, it } from 'vitest';
import { protectionProfileSchema, registerSchema, verifyEmailSchema } from './index';

describe('authentication schemas', () => {
  it('normalizes email and username', () => {
    expect(
      registerSchema.parse({
        email: ' USER@Example.COM ',
        username: ' Janus_User ',
        password: 'correct horse battery staple',
      }),
    ).toMatchObject({ email: 'user@example.com', username: 'janus_user' });
  });

  it('only accepts six digit verification codes', () => {
    expect(verifyEmailSchema.safeParse({ email: 'user@example.com', code: '12345' }).success).toBe(
      false,
    );
  });
});

describe('protection profile schema', () => {
  const profile = {
    level: 'STRONG',
    runtimeInjection: true,
    integrity: true,
    obfuscation: true,
  } as const;

  it('accepts safe relative exclusion paths', () => {
    expect(
      protectionProfileSchema.parse({ ...profile, excludePaths: ['includes/**', 'legacy.php'] }),
    ).toMatchObject({ excludePaths: ['includes/**', 'legacy.php'] });
  });

  it('rejects traversal and absolute exclusion paths', () => {
    expect(
      protectionProfileSchema.safeParse({ ...profile, excludePaths: ['../secrets'] }).success,
    ).toBe(false);
    expect(
      protectionProfileSchema.safeParse({ ...profile, excludePaths: ['/etc/passwd'] }).success,
    ).toBe(false);
  });
});
