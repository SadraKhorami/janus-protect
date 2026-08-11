'use client';

import { registerSchema } from '@janus/validation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard, Field, FormMessage, SubmitButton } from '../../components/auth-card';
import { apiClient, ApiError } from '../../lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      email: data.get('email'),
      username: data.get('username'),
      password: data.get('password'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details.');
      return;
    }
    setPending(true);
    try {
      await apiClient.register(parsed.data);
      router.push(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Registration failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start with a private workspace for your WordPress products."
      footer={
        <>
          Already registered?{' '}
          <Link href="/login" className="text-emerald-300 hover:text-emerald-200">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormMessage error={error} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Username" name="username" autoComplete="username" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <p className="text-xs leading-5 text-[var(--muted)]">Use at least 12 characters.</p>
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
