'use client';

import { forgotPasswordSchema } from '@janus/validation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthCard, Field, FormMessage, SubmitButton } from '../../components/auth-card';
import { apiClient, ApiError } from '../../lib/api-client';

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({ email: data.get('email') });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email.');
      return;
    }
    setPending(true);
    try {
      setMessage((await apiClient.forgotPassword(parsed.data)).message);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The request failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      description="We’ll email reset instructions if an account matches that address."
      footer={
        <Link href="/login" className="text-emerald-300 hover:text-emerald-200">
          Return to sign in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormMessage message={message} error={error} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <SubmitButton pending={pending}>Send reset link</SubmitButton>
      </form>
    </AuthCard>
  );
}
