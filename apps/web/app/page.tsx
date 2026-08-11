import Link from 'next/link';
import { Brand } from '../components/brand';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-7 sm:px-10">
      <header className="flex items-center justify-between">
        <Brand />
        <Link
          href="/login"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/85 transition hover:border-white/30 hover:bg-white/5"
        >
          Sign in
        </Link>
      </header>

      <section className="grid flex-1 items-center gap-14 py-20 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="mb-5 text-xs font-semibold tracking-[0.2em] text-emerald-300">
            PROTECT · LICENSE · MONITOR
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.04] tracking-[-0.045em] sm:text-7xl">
            Ship WordPress products with confidence.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            A cloud foundation for source management, protected builds, secure licensing, releases,
            and installation intelligence.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#062518] transition hover:bg-[var(--accent-strong)]"
            >
              Create an account
            </Link>
            <a
              href="http://localhost:4000/api/docs"
              className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/30 hover:bg-white/5"
            >
              View API docs
            </a>
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)]/80 p-5 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="mb-5 flex items-center gap-2 border-b border-[var(--border)] pb-4">
            <span className="size-2 rounded-full bg-emerald-300" />
            <span className="text-xs text-[var(--muted)]">Platform foundation online</span>
          </div>
          <div className="space-y-3">
            {[
              ['Identity', 'Argon2id · rotating sessions'],
              ['Tenancy', 'Organization-aware access'],
              ['Infrastructure', 'PostgreSQL · Redis · S3'],
              ['API', 'Versioned · typed · documented'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-[var(--panel-soft)] p-4">
                <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div>
                <div className="mt-1 text-sm text-white/90">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
