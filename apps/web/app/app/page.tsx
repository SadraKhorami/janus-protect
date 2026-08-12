'use client';

import type { IssuedLicense, License, Project } from '@janus/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Brand } from '../../components/brand';
import { useAuth } from '../../features/auth/auth-provider';
import { ApiError, apiClient } from '../../lib/api-client';

export default function AppPage() {
  const auth = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('');
  const [licenses, setLicenses] = useState<License[]>([]);
  const [issued, setIssued] = useState<IssuedLicense | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth.loading && !auth.account) router.replace('/login');
    if (auth.account) {
      void apiClient.projects().then((items) => {
        setProjects(items);
        setSelected((current) => current || items[0]?.id || '');
      });
    }
  }, [auth.account, auth.loading, router]);

  useEffect(() => {
    if (!selected) return;
    void apiClient.licenses(selected).then(setLicenses).catch(showError(setError));
  }, [selected]);

  if (auth.loading || !auth.account)
    return (
      <main className="grid min-h-screen place-items-center text-sm text-[var(--muted)]">
        Checking session…
      </main>
    );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const emailValue = form.get('email');
    const activationValue = form.get('maxActivations');
    const customerEmail = typeof emailValue === 'string' ? emailValue.trim() : '';
    try {
      const result = await apiClient.createLicense(selected, {
        ...(customerEmail ? { customerEmail } : {}),
        maxActivations: typeof activationValue === 'string' ? Number(activationValue) : 1,
      });
      setIssued(result);
      setLicenses((items) => [result, ...items]);
      event.currentTarget.reset();
    } catch (reason) {
      showError(setError)(reason);
    }
  }

  async function revoke(licenseId: string) {
    try {
      const result = await apiClient.revokeLicense(selected, licenseId);
      setLicenses((items) => items.map((item) => (item.id === licenseId ? result : item)));
    } catch (reason) {
      showError(setError)(reason);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-7 sm:px-10">
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
      <section className="py-12">
        <p className="text-sm font-medium text-emerald-300">License management</p>
        <h1 className="mt-2 text-3xl font-semibold">{auth.account.organization.name}</h1>
        <div className="mt-8 grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <h2 className="mb-3 font-medium">Projects</h2>
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setSelected(project.id);
                  setIssued(null);
                }}
                className={`mb-2 w-full rounded-lg px-3 py-3 text-left text-sm ${selected === project.id ? 'bg-emerald-400/15 text-emerald-200' : 'hover:bg-white/5'}`}
              >
                {project.name}
                <span className="mt-1 block text-xs text-[var(--muted)]">{project.type}</span>
              </button>
            ))}
            {!projects.length && (
              <p className="text-sm text-[var(--muted)]">
                Create and upload a project through the API first.
              </p>
            )}
          </aside>
          <div className="space-y-5">
            {issued && (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-5">
                <strong>Copy this key now — it is shown once.</strong>
                <code className="mt-3 block break-all rounded bg-black/30 p-3 text-emerald-200">
                  {issued.key}
                </code>
              </div>
            )}
            {selected && (
              <form
                onSubmit={(event) => void create(event)}
                className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:grid-cols-[1fr_150px_auto]"
              >
                <input
                  name="email"
                  type="email"
                  placeholder="Customer email (optional)"
                  className="rounded-lg border border-white/15 bg-black/20 px-3 py-2"
                />
                <input
                  name="maxActivations"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="1"
                  className="rounded-lg border border-white/15 bg-black/20 px-3 py-2"
                />
                <button className="rounded-lg bg-emerald-400 px-4 py-2 font-medium text-black">
                  Issue license
                </button>
              </form>
            )}
            {error && (
              <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-red-200">
                {error}
              </div>
            )}
            <div className="space-y-3">
              {licenses.map((license) => (
                <div
                  key={license.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5"
                >
                  <div>
                    <code>{license.keyPrefix}…</code>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {license.customerEmail || 'No customer email'} · {license.activeActivations}/
                      {license.maxActivations} active
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={license.status === 'ACTIVE' ? 'text-emerald-300' : 'text-red-300'}
                    >
                      {license.status}
                    </span>
                    {license.status === 'ACTIVE' && (
                      <button
                        onClick={() => void revoke(license.id)}
                        className="rounded border border-red-400/30 px-3 py-1 text-sm text-red-200"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function showError(setter: (value: string) => void) {
  return (reason: unknown) =>
    setter(reason instanceof ApiError ? reason.message : 'The request failed.');
}
