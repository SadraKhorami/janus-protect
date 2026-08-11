import Link from 'next/link';

export function Brand() {
  return (
    <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold tracking-wide">
      <span className="grid size-9 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">
        J
      </span>
      <span>JANUS PROTECT</span>
    </Link>
  );
}
