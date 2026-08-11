'use client';

import { resetPasswordSchema } from '@janus/validation';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthCard, Field, FormMessage, SubmitButton } from '../../components/auth-card';
import { apiClient, ApiError } from '../../lib/api-client';

function ResetPasswordForm() {
  const search = useSearchParams();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setError(undefined);
    const token = search.get('token') ?? '';
    const data = new FormData(event.currentTarget);
    const parsed = resetPasswordSchema.safeParse({ token, password: data.get('password') });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'The link or password is invalid.');
      return;
    }
    setPending(true);
    try {
      setMessage((await apiClient.resetPassword(parsed.data)).message);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Password reset failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Reset links are single-use and expire after 30 minutes."
      footer={
        <Link href="/login" className="text-emerald-300 hover:text-emerald-200">
          Return to sign in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormMessage message={message} error={error} />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <SubmitButton pending={pending}>Update password</SubmitButton>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
