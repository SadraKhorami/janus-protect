import type { ReactNode } from 'react';
import { Brand } from './brand';

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl shadow-black/20 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
          <div className="mt-7">{children}</div>
        </section>
        {footer ? (
          <div className="mt-5 text-center text-sm text-[var(--muted)]">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

export function Field({
  label,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm text-white/90">
      <span>{label}</span>
      <input
        {...input}
        className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[#0c1118] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-300/10"
      />
    </label>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#062518] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Please wait…' : children}
    </button>
  );
}

export function FormMessage({
  message,
  error,
}: {
  message?: string | undefined;
  error?: string | undefined;
}) {
  if (!message && !error) return null;
  return (
    <p
      role="status"
      className={`rounded-lg border px-3 py-2.5 text-sm ${
        error
          ? 'border-red-300/20 bg-red-300/10 text-[var(--danger)]'
          : 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200'
      }`}
    >
      {error ?? message}
    </p>
  );
}
