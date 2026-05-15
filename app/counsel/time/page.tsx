import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { listOpenTimer } from '@/lib/time-tracking';
import { TimerWidget } from '@/components/TimerWidget';

export const dynamic = 'force-dynamic';
// Audit W20 V3 CR-27: title template applies once at layout level.
export const metadata = { title: 'Time · Counsel' };

function fmtDuration(seconds: number) {
  const hours = seconds / 3600;
  return `${hours.toFixed(2)} h`;
}
function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export default async function CounselTimePage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/time');

  const supabase = createServerSupabase();
  const openTimer = await listOpenTimer(ctx.firm.id);

  const { data: entriesRaw } = await supabase
    .from('firm_time_entries')
    .select(
      'id, user_id, case_id, description, started_at, ended_at, duration_seconds, billable, rate_cents, source, invoice_id',
    )
    .eq('firm_id', ctx.firm.id)
    .order('started_at', { ascending: false })
    .limit(200);

  const entries = (entriesRaw ?? []) as Array<{
    id: string;
    user_id: string;
    case_id: string | null;
    description: string | null;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    billable: boolean;
    rate_cents: number | null;
    source: string;
    invoice_id: string | null;
  }>;

  // Aggregate this-week + this-month + unbilled.
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const week = entries.filter(
    (e) => Date.parse(e.started_at) >= weekAgo && e.duration_seconds,
  );
  const month = entries.filter(
    (e) => Date.parse(e.started_at) >= monthAgo && e.duration_seconds,
  );
  const unbilled = entries.filter(
    (e) => e.billable && !e.invoice_id && (e.duration_seconds ?? 0) > 0,
  );

  const sumSec = (arr: typeof entries) =>
    arr.reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
  const sumCents = (arr: typeof entries) =>
    arr.reduce(
      (s, e) =>
        s + Math.round((e.rate_cents ?? 0) * ((e.duration_seconds ?? 0) / 3600)),
      0,
    );

  return (
    <div className="space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Counsel · time</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Time entries
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Every billable and non-billable minute logged across the firm.
            Start a timer from the case page and it lands here. Unbilled
            entries roll up into invoices on the billing tab.
          </p>
        </div>
        <TimerWidget firmId={ctx.firm.id} initial={openTimer} />
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="This week"
          value={fmtDuration(sumSec(week))}
          sub={fmtCents(sumCents(week))}
        />
        <Stat
          label="This month"
          value={fmtDuration(sumSec(month))}
          sub={fmtCents(sumCents(month))}
        />
        <Stat
          label="Unbilled"
          value={fmtDuration(sumSec(unbilled))}
          sub={fmtCents(sumCents(unbilled))}
          tone="amber"
        />
        <Stat
          label="Total entries"
          value={String(entries.length)}
          sub={`${entries.filter((e) => e.invoice_id).length} invoiced`}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Recent entries
        </h2>
        {entries.length === 0 ? (
          <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            No time entries yet. Start a timer to log work.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.slice(0, 100).map((e) => {
              const cents = Math.round(
                (e.rate_cents ?? 0) * ((e.duration_seconds ?? 0) / 3600),
              );
              return (
                <li
                  key={e.id}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                        {e.description ?? 'Time entry'}
                      </p>
                      {e.invoice_id && (
                        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40">
                          Invoiced
                        </span>
                      )}
                      {!e.billable && (
                        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40">
                          Non-billable
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5 font-mono tabular-nums">
                      {new Date(e.started_at).toLocaleString()}
                      {e.case_id && ` · case ${e.case_id.slice(0, 8)}...`}
                      {' · '}
                      {e.source}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono tabular-nums text-forest-900 dark:text-cream-100 font-semibold">
                      {e.duration_seconds
                        ? fmtDuration(e.duration_seconds)
                        : 'running'}
                    </p>
                    {cents > 0 && (
                      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono tabular-nums">
                        {fmtCents(cents)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'gray',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'gray' | 'amber';
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-forest-900 dark:text-cream-100';
  return (
    <div className="card p-5">
      <p className="eyebrow text-[10.5px] mb-2">{label}</p>
      <p className={`font-display text-3xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1.5 font-mono tabular-nums">
          {sub}
        </p>
      )}
    </div>
  );
}
