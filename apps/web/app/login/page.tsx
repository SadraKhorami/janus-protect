'use client';

import { loginSchema } from '@janus/validation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard, Field, FormMessage, SubmitButton } from '../../components/auth-card';
import { useAuth } from '../../features/auth/auth-provider';
import { ApiError } from '../../lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      identifier: data.get('identifier'),
      password: data.get('password'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details.');
      return;
    }
    setPending(true);
    try {
      await auth.login(parsed.data);
      router.replace('/app');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your Janus Protect workspace."
      footer={
        <>
          New to Janus Protect?{' '}
          <Link href="/register" className="text-emerald-300 hover:text-emerald-200">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormMessage error={error} />
        <Field label="Email or username" name="identifier" autoComplete="username" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className="text-right">
          <Link href="/forgot-password" className="text-xs text-emerald-300 hover:text-emerald-200">
            Forgot password?
          </Link>
        </div>
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
