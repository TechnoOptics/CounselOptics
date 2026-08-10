'use client';

/**
 * Deadline Radar - flagship feature.
 *
 * Every date that can hurt you, across every case, in one calm
 * place - sorted by urgency with live countdowns. Missing a
 * deadline is the single most common way a self-represented
 * litigant loses; this makes that almost impossible to do by
 * accident.
 */

import Link from 'next/link';
import { formatDateWith } from '@/lib/format';

export type RadarItem = {
  caseId: string;
  caseTitle: string;
  at: string; // ISO
  label: string;
  location?: string | null;
};

function tier(ms: number) {
  if (ms < 0)
    return {
      ring: 'ring-rose-300',
      dot: 'bg-rose-500',
      chip: 'text-rose-700 bg-rose-50 border-rose-200',
      word: 'Passed',
    };
  const days = ms / 86_400_000;
  if (days <= 3)
    return {
      ring: 'ring-rose-300',
      dot: 'bg-rose-500 animate-pulse',
      chip: 'text-rose-700 bg-rose-50 border-rose-200',
      word: 'Critical',
    };
  if (days <= 7)
    return {
      ring: 'ring-amber-300',
      dot: 'bg-amber-500',
      chip: 'text-amber-800 bg-amber-50 border-amber-200',
      word: 'This week',
    };
  if (days <= 30)
    return {
      ring: 'ring-gold-300',
      dot: 'bg-gold-500',
      chip: 'text-forest-800 bg-cream-50 border-gold-200',
      word: 'Soon',
    };
  return {
    ring: 'ring-forest-200',
    dot: 'bg-forest-500',
    chip: 'text-forest-700 bg-cream-50 border-forest-200',
    word: 'Scheduled',
  };
}

function countdown(ms: number): string {
  if (ms < 0) {
    const d = Math.floor(-ms / 86_400_000);
    return d === 0 ? 'Earlier today' : `${d} day${d === 1 ? '' : 's'} ago`;
  }
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  if (d < 14) return `in ${d} day${d === 1 ? '' : 's'}`;
  if (d < 60) return `in ${Math.round(d / 7)} weeks`;
  return `in ${Math.round(d / 30)} months`;
}

export function DeadlineRadar({ items }: { items: RadarItem[] }) {
  const now = Date.now();
  const sorted = [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const upcoming = sorted.filter((i) => Date.parse(i.at) >= now - 86_400_000);

  return (
    <div className="space-y-7 animate-fade-up">
      <div>
        <p className="eyebrow mb-2">Deadline Radar</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-forest-900">
          Nothing slips past you
        </h1>
        <p className="text-sm text-ink-500 mt-1.5 max-w-xl leading-relaxed">
          Every hearing and deadline across all your cases, by
          urgency. The clock is always running - this keeps it in
          view.
        </p>
      </div>

      {upcoming.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-600">
          No upcoming deadlines on record. When you add a hearing to a
          case, it appears here automatically.
        </div>
      ) : (
        <ol className="space-y-3">
          {upcoming.map((it, idx) => {
            const ms = Date.parse(it.at) - now;
            const t = tier(ms);
            return (
              <li key={`${it.caseId}-${idx}`}>
                <Link
                  href={`/cases/${it.caseId}#hearing`}
                  className={`card-hover p-5 flex items-center gap-4 block ring-1 ${t.ring}`}
                >
                  <span className="relative flex-none">
                    <span
                      className={`block h-3 w-3 rounded-full ${t.dot}`}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-semibold text-ink-950 truncate">
                        {it.caseTitle}
                      </span>
                      <span
                        className={`badge border ${t.chip} text-[10px]`}
                      >
                        {t.word}
                      </span>
                    </span>
                    <span className="block text-sm text-ink-600 mt-0.5">
                      {it.label}
                      {it.location ? ` · ${it.location}` : ''}
                    </span>
                    <span className="block text-[11px] text-ink-400 mt-0.5">
                      {formatDateWith(it.at, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                  <span className="flex-none text-right">
                    <span className="block text-sm font-semibold tabular-nums text-forest-900">
                      {countdown(ms)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-[11px] text-ink-400 leading-relaxed">
        Reflects dates you have entered on your cases. It is a
        reminder aid, not a guarantee - always confirm deadlines
        against the court&rsquo;s own record.
      </p>
    </div>
  );
}
