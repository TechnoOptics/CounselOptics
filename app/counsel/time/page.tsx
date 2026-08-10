import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmCases } from '@/lib/firm-storage';
import { getFirmSurfaceSettings } from '@/lib/firm-settings';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { listOpenTimer } from '@/lib/time-tracking';
import { TimerWidget } from '@/components/TimerWidget';
import { AssignMatter } from './assign-matter';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  PanelCard,
  MonoRef,
  relativeTime,
} from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';
import { formatDateTimeNumeric } from '@/lib/format';

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
  if ((await getFirmSurfaceSettings(ctx.firm.id)).hideTimeBilling) {
    redirect('/counsel');
  }
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/time');

  const supabase = createServerSupabase();
  const openTimer = await listOpenTimer(ctx.firm.id);
  // The matters a timer can be started on, and the ones an orphaned entry can
  // be moved onto. Time that names no matter cannot go on any invoice, so this
  // page cannot offer a timer without them.
  const caseOptions = (await listFirmCases(ctx.firm.id)).map((c) => ({
    id: c.id,
    title: c.title,
  }));

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
      <PageHeader
        eyebrow={<T>Counsel · time</T>}
        title={<T>Time entries</T>}
        subtitle={
          <T>Every billable and non-billable minute logged across the firm.
          Start a timer here or from a matter, and pick the matter it belongs
          to: an invoice is drawn from one matter&rsquo;s unbilled time, so time
          with no matter on it cannot be billed.</T>
        }
        action={
          <TimerWidget
            firmId={ctx.firm.id}
            initial={openTimer}
            cases={caseOptions}
          />
        }
      />

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat
          label={<T>This week</T>}
          value={fmtDuration(sumSec(week))}
          sub={fmtCents(sumCents(week))}
        />
        <Stat
          label={<T>This month</T>}
          value={fmtDuration(sumSec(month))}
          sub={fmtCents(sumCents(month))}
        />
        <Stat
          label={<T>Unbilled</T>}
          value={fmtDuration(sumSec(unbilled))}
          sub={fmtCents(sumCents(unbilled))}
          tone="amber"
        />
        <Stat
          label={<T>Total entries</T>}
          value={String(entries.length)}
          sub={
            <>
              {entries.filter((e) => e.invoice_id).length} <T>invoiced</T>
            </>
          }
        />
      </section>

      {/* Entries, on the list pattern's table. Every duration and amount
          is the same figure under the same label as before; only the row
          geometry changed. */}
      {entries.length === 0 ? (
        <EmptyState
          title={<T>No time entries yet.</T>}
          sub={<T>Start a timer to log work.</T>}
        />
      ) : (
        <PanelCard
          title={<T>Recent entries</T>}
          bodyClassName=""
          action={
            <p className="text-[12px] tabular-nums text-muted">
              {Math.min(entries.length, 100)}
            </p>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left">
              <thead className="border-b border-edge">
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                  <th scope="col" className="px-3 py-2"><T>Entry</T></th>
                  <th scope="col" className="px-3 py-2"><T>Case</T></th>
                  <th scope="col" className="px-3 py-2"><T>Source</T></th>
                  <th scope="col" className="px-3 py-2"><T>Started</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Duration</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Value</T></th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 100).map((e) => {
                  const cents = Math.round(
                    (e.rate_cents ?? 0) * ((e.duration_seconds ?? 0) / 3600),
                  );
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {e.description ? (
                            <span
                              className="text-[13px] font-medium text-foreground"
                              data-no-translate
                            >
                              {e.description}
                            </span>
                          ) : (
                            <span className="text-[13px] font-medium text-foreground">
                              <T>Time entry</T>
                            </span>
                          )}
                          {e.invoice_id && (
                            <StatusPill color={PILL_COLORS.good} size="sm" dot>
                              <T>Invoiced</T>
                            </StatusPill>
                          )}
                          {!e.billable && (
                            <StatusPill color={PILL_COLORS.neutral} size="sm" dot>
                              <T>Non-billable</T>
                            </StatusPill>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {e.case_id ? (
                          <MonoRef title={e.case_id}>
                            {e.case_id.slice(0, 8)}
                          </MonoRef>
                        ) : !e.invoice_id &&
                          e.user_id === user.id &&
                          caseOptions.length > 0 ? (
                          // The recovery control, and only where it would
                          // work: the reader's own entry, not yet invoiced.
                          <AssignMatter
                            firmId={ctx.firm.id}
                            entryId={e.id}
                            cases={caseOptions}
                          />
                        ) : (
                          <span className="text-[12px] text-muted">
                            <T>None</T>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-muted">
                        {e.source}
                      </td>
                      <td
                        className="px-3 py-2.5 text-[12px] text-muted"
                        title={formatDateTimeNumeric(e.started_at)}
                        suppressHydrationWarning
                      >
                        {relativeTime(e.started_at) ?? ''}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums text-foreground">
                        {e.duration_seconds
                          ? fmtDuration(e.duration_seconds)
                          : 'running'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted">
                        {cents > 0 ? fmtCents(cents) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PanelCard>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'gray',
}: {
  label: React.ReactNode;
  value: string;
  sub?: React.ReactNode;
  tone?: 'gray' | 'amber';
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-foreground';
  return (
    <div className="card p-5">
      <p className="eyebrow text-[10.5px] mb-2">{label}</p>
      <p className={`text-3xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-muted mt-1.5 font-mono tabular-nums">
          {sub}
        </p>
      )}
    </div>
  );
}
