'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Brand } from '../../components/brand';
import { useAuth } from '../../features/auth/auth-provider';

export default function AppPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.loading && !auth.account) router.replace('/login');
  }, [auth.account, auth.loading, router]);

  if (auth.loading || !auth.account) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-[var(--muted)]">
        Checking session…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-7 sm:px-10">
      <header className="flex items-center justify-between">
        <Brand />
        <button
          type="button"
          onClick={() => void auth.logout().then(() => router.replace('/login'))}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
        >
          Sign out
        </button>
      </header>

      <section className="py-20">
        <p className="text-sm font-medium text-emerald-300">Authenticated workspace</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Welcome, {auth.account.username}.
        </h1>
        <p className="mt-4 max-w-2xl text-[var(--muted)]">
          The project dashboard arrives in a later milestone. Your identity and organization
          foundation are ready.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Info label="Email" value={auth.account.email} />
          <Info label="Account status" value={auth.account.status} />
          <Info label="Organization" value={auth.account.organization.name} />
          <Info label="Role" value={auth.account.organization.role} />
          <Info label="API status" value="Connected" accent />
        </div>
      </section>
    </main>
  );
}

function Info({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className={`mt-2 text-sm ${accent ? 'text-emerald-300' : 'text-white/90'}`}>{value}</div>
    </div>
  );
}
