'use client';

import { resendVerificationSchema, verifyEmailSchema } from '@janus/validation';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthCard, Field, FormMessage, SubmitButton } from '../../components/auth-card';
import { apiClient, ApiError } from '../../lib/api-client';

function VerifyEmailForm() {
  const search = useSearchParams();
  const [email, setEmail] = useState(search.get('email') ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const parsed = verifyEmailSchema.safeParse({ email, code: data.get('code') });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the code.');
      return;
    }
    setPending(true);
    try {
      const result = await apiClient.verifyEmail(parsed.data);
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Verification failed.');
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setMessage(undefined);
    setError(undefined);
    const parsed = resendVerificationSchema.safeParse({ email });
    if (!parsed.success) {
      setError('Enter the email used to register.');
      return;
    }
    setPending(true);
    try {
      const result = await apiClient.resendVerification(parsed.data);
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The code could not be resent.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Verify your email"
      description="Enter the six-digit code sent to your inbox. Codes expire after 15 minutes."
      footer={
        <Link href="/login" className="text-emerald-300 hover:text-emerald-200">
          Return to sign in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormMessage message={message} error={error} />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Field
          label="Verification code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
        />
        <SubmitButton pending={pending}>Verify email</SubmitButton>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={pending}
          className="w-full py-2 text-sm text-[var(--muted)] hover:text-white disabled:opacity-50"
        >
          Send another code
        </button>
      </form>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
