import { describe, expect, it } from 'vitest';
import { registerSchema, verifyEmailSchema } from './index';

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
