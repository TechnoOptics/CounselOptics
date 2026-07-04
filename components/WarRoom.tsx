'use client';

/**
 * War Room - cross-case command center.
 *
 * One screen to run your whole legal life: what needs you right now,
 * every deadline on one clock, and a computed "next best move" for
 * each case. Deterministic (no AI cost, instant) - rules over the
 * case data you already have. This is the surface that makes the app
 * feel like a category leader instead of a folder of forms.
 */

import Link from 'next/link';

export type WarItem = {
  id: string;
  title: string;
  status: string;
  posture: string;
  caseType: string;
  hearingAt: string | null;
  updatedAt: string;
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return null;
  return Math.floor((d - Date.now()) / 86_400_000);
}

const CLOSED = new Set(['closed', 'archived']);

function nextMove(it: WarItem): {
  text: string;
  href: string;
  tone: 'urgent' | 'warn' | 'go' | 'calm';
} {
  const dh = daysUntil(it.hearingAt);
  if (CLOSED.has(it.status))
    return { text: 'Archived - reopen if needed', href: `/cases/${it.id}`, tone: 'calm' };
  if (dh !== null && dh < 0)
    return {
      text: 'Hearing date passed - update the case',
      href: `/cases/${it.id}#hearing`,
      tone: 'urgent',
    };
  if (dh !== null && dh <= 3)
    return {
      text: `Hearing in ${dh <= 0 ? 'hours' : `${dh}d`} - enter Courtroom Mode`,
      href: `/cases/${it.id}/courtroom`,
      tone: 'urgent',
    };
  if (dh !== null && dh <= 14)
    return {
      text: `Hearing in ${dh}d - run a practice cross-examination`,
      href: `/cases/${it.id}`,
      tone: 'warn',
    };
  if (it.status === 'draft')
    return { text: 'Finish setting up this case', href: `/cases/${it.id}`, tone: 'warn' };
  if (it.status === 'needs_evidence')
    return {
      text: 'Marked needs evidence - check the Strength tab',
      href: `/cases/${it.id}`,
      tone: 'warn',
    };
  const stale = daysUntil(it.updatedAt);
  if (stale !== null && stale < -30)
    return {
      text: 'Untouched a while - revisit and refresh',
      href: `/cases/${it.id}`,
      tone: 'calm',
    };
  return {
    text: 'Test your evidence in the Strength tab',
    href: `/cases/${it.id}`,
    tone: 'go',
  };
}

const TONE: Record<string, string> = {
  urgent: 'border-rose-300 bg-rose-50/60 text-rose-800',
  warn: 'border-amber-300 bg-amber-50/50 text-amber-900',
  go: 'border-gold-200 bg-cream-50 text-forest-800',
  calm: 'border-ink-200 bg-white text-ink-600',
};

export function WarRoom({ items }: { items: WarItem[] }) {
  const open = items.filter((i) => !CLOSED.has(i.status));
  const withMove = open.map((i) => ({ it: i, mv: nextMove(i) }));
  const attention = withMove
    .filter((x) => x.mv.tone === 'urgent' || x.mv.tone === 'warn')
    .sort((a, b) => {
      const da = daysUntil(a.it.hearingAt) ?? 9999;
      const db = daysUntil(b.it.hearingAt) ?? 9999;
      return da - db;
    });
  const deadlines = open
    .filter((i) => i.hearingAt && (daysUntil(i.hearingAt) ?? -1) >= 0)
    .sort((a, b) => Date.parse(a.hearingAt!) - Date.parse(b.hearingAt!));

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Action Center</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-forest-900">
            What needs you right now
          </h1>
          <p className="text-sm text-ink-500 mt-1.5 max-w-xl leading-relaxed">
            Every case, every clock, and the single best next move for
            each - plus your time-sensitive tools, in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/deadlines" className="btn-secondary">
            Deadline Radar
          </Link>
          <Link href="/decoder" className="btn-secondary">
            Decode a document
          </Link>
          <Link href="/action-center/mock-trial" className="btn-secondary">
            Mock trial
          </Link>
          <Link href="/safe" className="btn-secondary">
            Safe Witness
          </Link>
          <Link href="/cases/new/speak" className="btn-primary">
            Speak a new case
          </Link>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Active cases" value={open.length} accent="emerald" />
        <Stat label="Need attention" value={attention.length} accent="rose" />
        <Stat label="Upcoming deadlines" value={deadlines.length} accent="gold" />
        <Stat
          label="Closed"
          value={items.length - open.length}
          accent="ink"
        />
      </div>

      {/* Needs attention */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700">
          Needs you now
        </h2>
        {attention.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-500">
            Nothing on fire. Every active case is in good shape.
          </div>
        ) : (
          <div className="space-y-2">
            {attention.map(({ it, mv }) => (
              <Link
                key={it.id}
                href={mv.href}
                className={`card-hover p-4 flex items-center justify-between gap-4 block border ${TONE[mv.tone]}`}
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink-950 truncate">
                    {it.title}
                  </span>
                  <span className="block text-sm mt-0.5">{mv.text}</span>
                </span>
                <span aria-hidden className="flex-none text-lg">
                  &rarr;
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* All cases at a glance */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700">
          Every case, next move
        </h2>
        {open.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-600">
            No active cases.{' '}
            <Link href="/cases/new/speak" className="underline text-forest-800">
              Speak your first one
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 stagger">
            {withMove.map(({ it, mv }, i) => {
              const dh = daysUntil(it.hearingAt);
              return (
                <Link
                  key={it.id}
                  href={mv.href}
                  className="card-hover p-5 block animate-fade-up"
                  style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-[17px] font-medium text-ink-950 leading-tight">
                      {it.title}
                    </h3>
                    <span className="badge bg-cream-50 text-forest-800 border border-gold-200 text-[10px] flex-none capitalize">
                      {it.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-ink-500 mt-1">
                    {it.caseType} · {it.posture}
                    {dh !== null &&
                      dh >= 0 &&
                      ` · hearing in ${dh}d`}
                  </p>
                  <p
                    className={`mt-3 text-xs rounded-lg px-3 py-2 border ${TONE[mv.tone]}`}
                  >
                    <span className="font-semibold">Next: </span>
                    {mv.text}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Time-sensitive tools. Folded in here so the Action Center is
          one surface: practice for a hearing, decode a document, or
          reach your trusted contacts - without leaving the cockpit. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700">
          Your tools
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ToolTile
            href="/action-center/mock-trial"
            title="Mock trial"
            body="Argue your case out loud. Advottic plays opposing counsel and the judge, asks the hard questions, then coaches you - before the real hearing."
            cta="Step up to the stand"
            tone="forest"
          />
          <ToolTile
            href="/safe"
            title="Safe Witness"
            body="One press alerts your trusted contacts with your location and a voice memo. Set up your contacts first, then trigger from any device."
            cta="Open Safe Witness"
            tone="rose"
          />
          <ToolTile
            href="/decoder"
            title="Decode a document"
            body="Paste or attach a court notice, letter, or contract - even a photo - and get it back in plain English with the deadlines spelled out."
            cta="Decode now"
            tone="forest"
          />
          <ToolTile
            href="/deadlines"
            title="Deadline Radar"
            body="Hearings, filings, and statute-of-limitations cutoffs across every case, sorted by what bites first."
            cta="Open Deadline Radar"
            tone="gold"
          />
        </div>
      </section>
    </div>
  );
}

function ToolTile({
  href,
  title,
  body,
  cta,
  tone,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
  tone: 'forest' | 'rose' | 'gold';
}) {
  const chip =
    tone === 'rose'
      ? 'bg-rose-500/12 text-rose-700 ring-rose-200/70'
      : tone === 'gold'
        ? 'bg-gold-400/15 text-gold-800 ring-gold-200/70'
        : 'bg-forest-900/8 text-forest-900 ring-forest-900/15';
  return (
    <Link href={href} className="card-hover p-5 block animate-fade-up">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] font-bold ring-1 ${chip}`}
      >
        {title}
      </span>
      <p className="text-[13px] text-ink-600 mt-2.5 leading-relaxed">{body}</p>
      <span className="mt-3 inline-flex items-center text-sm font-medium text-forest-900">
        {cta}
        <span aria-hidden className="ml-1.5">
          &rarr;
        </span>
      </span>
    </Link>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'emerald' | 'rose' | 'gold' | 'ink';
}) {
  const c =
    accent === 'emerald'
      ? 'text-emerald-600'
      : accent === 'rose'
        ? 'text-rose-600'
        : accent === 'gold'
          ? 'text-gold-600'
          : 'text-ink-500';
  return (
    <div className="card p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-400">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${c}`}>{value}</p>
    </div>
  );
}
