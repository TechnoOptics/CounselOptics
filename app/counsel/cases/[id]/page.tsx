import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { getOrCreateMatterChannelAction } from '@/lib/firm-actions';
import { listOpenTimer } from '@/lib/time-tracking';
import { listTrustTransactions } from '@/lib/trust-accounting-queries';
import { TimerWidget } from '@/components/TimerWidget';
import type { FirmMessage } from '@/lib/firm-types';
import { DraftInvoiceButton } from './draft-invoice-button';
import { AddDeadlineForm } from './add-deadline-form';
import { CompleteDeadlineButton } from './complete-deadline-button';
import { MatterChatPanel } from './matter-chat-panel';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

/**
 * Audit V5 CR-30: the counsel-side case detail used to show
 * "Cases · Advottic" in the browser tab for every matter, making
 * tab-switching across multiple open matters impossible. Reading
 * the matter title server-side and emitting it via the standard
 * "%s · Advottic" template turns each tab into a useful identifier.
 * Wrapped in try/catch so a transient DB failure can't 500 the tab
 * title - falls back to "Matter".
 */
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  try {
    const ctx = await getActiveFirmContext();
    if (!ctx) return { title: 'Matter' };
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('cases')
      .select('title, firm_id')
      .eq('id', params.id)
      .maybeSingle();
    if (!data || data.firm_id !== ctx.firm.id) {
      return { title: 'Matter · Not found' };
    }
    return {
      title: `${(data as { title: string }).title} · Matters`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: 'Matter' };
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  under_review: 'Under review',
  needs_evidence: 'Needs evidence',
  export_ready: 'Export ready',
  closed: 'Closed',
  archived: 'Archived',
};

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function fmtHours(seconds: number) {
  return `${(seconds / 3600).toFixed(2)} h`;
}

export default async function CounselCaseDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();

  // Pull case (RLS gates). The consumer-side `/cases/[id]` route
  // also works for firm members; this page adds firm-specific
  // panels (time, deadlines, invoicing, trust).
  const { data: caseRow } = await supabase
    .from('cases')
    .select('id, title, subject_name, case_type, posture, status, jurisdiction, hearing_at, description, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!caseRow) notFound();
  const c = caseRow as {
    id: string;
    title: string;
    subject_name: string;
    case_type: string;
    posture: string;
    status: string;
    jurisdiction: { state?: string } | null;
    hearing_at: string | null;
    description: string | null;
    firm_id: string | null;
  };
  if (c.firm_id !== ctx.firm.id) notFound();

  const openTimer = await listOpenTimer(ctx.firm.id);

  const [
    { data: timeRaw },
    { data: deadlinesRaw },
    { data: invoicesRaw },
    { data: signingRaw },
    { data: docsRaw },
    trustEntries,
  ] = await Promise.all([
    supabase
      .from('firm_time_entries')
      .select('id, description, started_at, ended_at, duration_seconds, billable, rate_cents, invoice_id, source')
      .eq('firm_id', ctx.firm.id)
      .eq('case_id', params.id)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('case_deadlines')
      .select('id, kind, title, due_at, completed_at')
      .eq('case_id', params.id)
      .order('due_at', { ascending: true }),
    supabase
      .from('firm_invoices')
      .select('id, number, status, total_cents, created_at, sent_at, paid_at, stripe_payment_link')
      .eq('firm_id', ctx.firm.id)
      .eq('case_id', params.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('firm_signing_requests')
      .select('id, status, created_at, document_id')
      .eq('firm_id', ctx.firm.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('firm_documents')
      .select('id, name, status, status_updated_at, due_at')
      .eq('firm_id', ctx.firm.id)
      .eq('case_id', params.id)
      .order('uploaded_at', { ascending: false })
      .limit(20),
    listTrustTransactions(ctx.firm.id, { caseId: params.id }),
  ]);

  const time = (timeRaw ?? []) as Array<{
    id: string;
    description: string | null;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    billable: boolean;
    rate_cents: number | null;
    invoice_id: string | null;
    source: string;
  }>;
  const deadlines = (deadlinesRaw ?? []) as Array<{
    id: string;
    kind: string;
    title: string;
    due_at: string;
    completed_at: string | null;
  }>;
  const invoices = (invoicesRaw ?? []) as Array<{
    id: string;
    number: string;
    status: string;
    total_cents: number;
    created_at: string;
    sent_at: string | null;
    paid_at: string | null;
    stripe_payment_link: string | null;
  }>;
  const signing = (signingRaw ?? []) as Array<{
    id: string;
    status: string;
    created_at: string;
    document_id: string;
  }>;
  const docs = (docsRaw ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    status_updated_at: string;
    due_at: string | null;
  }>;

  const totalSeconds = time.reduce(
    (s, e) => s + (e.duration_seconds ?? 0),
    0,
  );
  const billableSeconds = time
    .filter((e) => e.billable && e.duration_seconds)
    .reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
  const unbilledCents = time
    .filter((e) => e.billable && !e.invoice_id && (e.duration_seconds ?? 0) > 0)
    .reduce(
      (s, e) =>
        s + Math.round((e.rate_cents ?? 0) * ((e.duration_seconds ?? 0) / 3600)),
      0,
    );
  const trustBalance = trustEntries.reduce((s, t) => {
    const positive =
      t.kind === 'deposit' || t.kind === 'refund' || t.kind === 'interest';
    return s + (positive ? t.amountCents : -t.amountCents);
  }, 0);

  return (
    <div className="space-y-8 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/cases"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          <T>&larr; Cases</T>
        </Link>
      </p>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1"><T>Counsel · matter</T></p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 break-words">
            {c.title}
          </h1>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
            {STATUS_LABEL[c.status] ?? c.status} · {c.case_type} ·{' '}
            {c.posture}
            {c.jurisdiction?.state && ` · ${c.jurisdiction.state}`}
            {' · '}
            <T>subject</T> {c.subject_name}
          </p>
        </div>
        <TimerWidget
          firmId={ctx.firm.id}
          initial={openTimer}
          caseId={params.id}
          caseTitle={c.title}
        />
      </header>

      {/* Top stats */}
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Time logged" value={fmtHours(totalSeconds)} />
        <Stat
          label="Billable hours"
          value={fmtHours(billableSeconds)}
          tone="sky"
        />
        <Stat
          label="Unbilled"
          value={fmtCents(unbilledCents)}
          tone={unbilledCents > 0 ? 'amber' : 'gray'}
        />
        <Stat
          label="Trust balance"
          value={fmtCents(trustBalance)}
          tone={trustBalance < 0 ? 'rose' : 'emerald'}
        />
      </section>

      {c.description && (
        <section className="card p-5">
          <p className="eyebrow text-[10px] mb-1"><T>Description</T></p>
          <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap">
            {c.description}
          </p>
        </section>
      )}

      {/* Matter room - idempotent: getOrCreate ensures one channel
          per case_id (the unique index on firm_channels.case_id
          guarantees we never duplicate). Auto-membership adds every
          firm member to the channel so the room is populated even
          before anyone explicitly joins. */}
      <MatterChatSection
        firmId={ctx.firm.id}
        caseId={params.id}
        caseTitle={c.title}
        currentUserId={ctx.membership.userId}
      />

      {/* Deadlines */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            <T>Deadlines</T>
          </h2>
        </div>
        {deadlines.length === 0 ? (
          <p className="card p-4 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            <T>No deadlines on this matter yet.</T>
          </p>
        ) : (
          <ul className="space-y-2">
            {deadlines.map((d) => {
              const overdue =
                !d.completed_at && Date.parse(d.due_at) < Date.now();
              return (
                <li
                  key={d.id}
                  className="card p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[13px] font-semibold truncate ${
                        d.completed_at
                          ? 'line-through text-ink-500 dark:text-cream-100/70'
                          : 'text-forest-900 dark:text-cream-100'
                      }`}
                    >
                      {d.title}
                    </p>
                    <p
                      className={`text-[11.5px] font-mono tabular-nums mt-0.5 ${
                        overdue
                          ? 'text-rose-700 dark:text-rose-300 font-semibold'
                          : 'text-ink-500 dark:text-cream-100/55'
                      }`}
                    >
                      {d.kind.replace(/_/g, ' ')} ·{' '}
                      {overdue ? 'OVERDUE ' : 'Due '}
                      {new Date(d.due_at).toLocaleString()}
                    </p>
                  </div>
                  {!d.completed_at && (
                    <CompleteDeadlineButton deadlineId={d.id} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <AddDeadlineForm
          caseId={params.id}
          firmId={ctx.firm.id}
          jurisdictionState={c.jurisdiction?.state ?? null}
        />
      </section>

      {/* Time entries */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            Time on this matter
          </h2>
          {unbilledCents > 0 && (
            <DraftInvoiceButton
              firmId={ctx.firm.id}
              caseId={params.id}
              caseTitle={c.title}
              unbilledCents={unbilledCents}
            />
          )}
        </div>
        {time.length === 0 ? (
          <p className="card p-4 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            No time entries yet. Start the timer in the header.
          </p>
        ) : (
          <ul className="space-y-2">
            {time.slice(0, 20).map((e) => (
              <li
                key={e.id}
                className="card p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-forest-900 dark:text-cream-100 truncate">
                    {e.description ?? 'Time entry'}
                  </p>
                  <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono tabular-nums mt-0.5">
                    {new Date(e.started_at).toLocaleString()}
                    {e.invoice_id && ' · invoiced'}
                    {!e.billable && ' · non-billable'}
                  </p>
                </div>
                <p className="shrink-0 font-mono tabular-nums text-forest-900 dark:text-cream-100 font-semibold text-[13px]">
                  {e.duration_seconds
                    ? fmtHours(e.duration_seconds)
                    : 'running'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Invoices */}
      {invoices.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            Invoices
          </h2>
          <ul className="space-y-2">
            {invoices.map((i) => (
              <li
                key={i.id}
                className="card p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
                    {i.number}
                  </p>
                  <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 font-mono">
                    {i.status} · {new Date(i.created_at).toLocaleDateString()}
                  </p>
                </div>
                <p className="shrink-0 font-mono tabular-nums text-forest-900 dark:text-cream-100 font-semibold text-[13px]">
                  {fmtCents(i.total_cents)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Trust ledger snippet */}
      {trustEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            Trust ledger (this matter)
          </h2>
          <ul className="space-y-1.5">
            {trustEntries.slice(0, 10).map((t) => (
              <li
                key={t.id}
                className="card p-3 flex items-center justify-between text-[13px]"
              >
                <span className="truncate">
                  <span className="font-mono text-[10.5px] text-ink-500 dark:text-cream-100/55 mr-2">
                    {t.kind.replace(/_/g, ' ')}
                  </span>
                  {t.description ?? t.clientLabel}
                </span>
                <span
                  className={`shrink-0 font-mono tabular-nums font-semibold ${
                    t.kind === 'deposit' ||
                    t.kind === 'refund' ||
                    t.kind === 'interest'
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {fmtCents(t.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Documents on this case */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            Documents
          </h2>
          <div className="flex items-center gap-2">
            <Link
              href={`/counsel/projects?caseId=${params.id}`}
              className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
            >
              Projects
            </Link>
            <Link
              href={`/counsel/letters?caseId=${params.id}`}
              className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
            >
              Draft a letter
            </Link>
          </div>
        </div>
        {docs.length > 0 ? (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li
                key={d.id}
                className="card p-3 flex items-center justify-between gap-3"
              >
                <Link
                  href={`/counsel/documents/${d.id}`}
                  className="text-[13px] text-forest-900 dark:text-cream-100 truncate flex-1"
                >
                  {d.name}
                </Link>
                <span className="shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40">
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
            No documents yet. Draft a letter or upload one from{' '}
            <Link href="/counsel/documents" className="underline">
              Documents
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value: string;
  tone?: 'gray' | 'sky' | 'amber' | 'emerald' | 'rose';
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'emerald'
        ? 'text-emerald-700 dark:text-emerald-300'
        : tone === 'sky'
          ? 'text-sky-700 dark:text-sky-300'
          : tone === 'rose'
            ? 'text-rose-700 dark:text-rose-300'
            : 'text-forest-900 dark:text-cream-100';
  return (
    <div className="card p-5">
      <p className="eyebrow text-[10.5px] mb-2"><T>{label}</T></p>
      <p className={`font-display text-2xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Server-rendered matter-chat section. Wraps the client MatterChatPanel
 * with the data it needs:
 *   - getOrCreateMatterChannelAction guarantees a channel exists (idempotent)
 *   - initial messages backfill so the panel mounts populated
 *   - author lookup map so messages render real names, not UUIDs
 *
 * Wrapped in a separate async component so the case detail page can
 * render the rest of its UI while the chat backfill resolves.
 */
async function MatterChatSection({
  firmId,
  caseId,
  caseTitle,
  currentUserId,
}: {
  firmId: string;
  caseId: string;
  caseTitle: string;
  currentUserId: string;
}) {
  const channelRes = await getOrCreateMatterChannelAction(firmId, caseId, caseTitle);
  if (!channelRes.ok || !channelRes.channelId) {
    return (
      <section className="card p-5">
        <p className="eyebrow text-[10px] mb-1">Matter room</p>
        <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          Could not prepare the matter chat. Reload the page or contact support.
        </p>
      </section>
    );
  }
  const channelId = channelRes.channelId;

  // Hydrate the most recent ~80 messages + author display names so the
  // chat panel mounts with real history. The Realtime subscription
  // picks up everything after; this just primes the pump.
  const supabase = createServerSupabase();
  const [{ data: messageRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from('firm_messages')
      .select('id, channel_id, user_id, body, attachments, created_at, edited_at, deleted_at')
      .eq('channel_id', channelId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(80),
    supabase
      .from('firm_members')
      .select('user_id, display_name, email')
      .eq('firm_id', firmId),
  ]);
  const initialMessages: FirmMessage[] = (messageRows ?? []).map(
    (r: Record<string, unknown>) => ({
      id: r.id as string,
      channelId: r.channel_id as string,
      userId: r.user_id as string,
      body: r.body as string,
      attachments: (r.attachments as FirmMessage['attachments']) ?? [],
      createdAt: r.created_at as string,
      editedAt: (r.edited_at as string | null) ?? null,
      deletedAt: (r.deleted_at as string | null) ?? null,
    }),
  );
  const authors = (memberRows ?? []).map((r: Record<string, unknown>) => ({
    userId: r.user_id as string,
    displayName: (r.display_name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
  }));

  return (
    <MatterChatPanel
      channelId={channelId}
      initialMessages={initialMessages}
      authors={authors}
      currentUserId={currentUserId}
    />
  );
}
