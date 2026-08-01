import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmSurfaceSettings } from '@/lib/firm-settings';
import { createServerSupabase } from '@/lib/supabase/server';
import { ExternalLink } from '@/components/ExternalLink';
import { isIosAppRequest } from '@/lib/ios-gate';
import { MarkPaidButton } from './mark-paid-button';
import { SendInvoiceButton } from './send-invoice-button';
import { InvoiceRowActions } from './invoice-actions';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Billing · Counsel' };

const STATUS_TONE: Record<string, string> = {
  draft:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  sent:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  paid:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  void:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
};

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export default async function CounselBillingPage() {
  // App Store Guideline 3.1.1. See the "Pay link" comment below - this page
  // surfaced the only raw, live Stripe URL anywhere in the app.
  const isIos = isIosAppRequest();
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if ((await getFirmSurfaceSettings(ctx.firm.id)).hideTimeBilling) {
    redirect('/counsel');
  }
  const supabase = createServerSupabase();

  const [
    { data: invoicesRaw },
    { data: allInvoiceTotalsRaw },
    { data: openTimerRaw },
    { data: unbilledRaw },
  ] = await Promise.all([
      supabase
        .from('firm_invoices')
        .select(
          'id, number, status, client_email, client_name, total_cents, currency, created_at, sent_at, paid_at, case_id, stripe_payment_link',
        )
        .eq('firm_id', ctx.firm.id)
        .order('created_at', { ascending: false })
        .limit(100),
      // Outstanding and Collected are the firm's receivables, so they are
      // summed over EVERY invoice, not over the 100 most recent shown
      // below. Reducing the capped display list understated what clients
      // owed as soon as a firm passed its 100th invoice.
      supabase
        .from('firm_invoices')
        .select('status, total_cents')
        .eq('firm_id', ctx.firm.id),
      supabase
        .from('firm_time_entries')
        .select('id, description, started_at, duration_seconds, rate_cents, case_id')
        .eq('firm_id', ctx.firm.id)
        .is('ended_at', null)
        .limit(20),
      supabase
        .from('firm_time_entries')
        .select('id, duration_seconds, rate_cents, case_id, billable')
        .eq('firm_id', ctx.firm.id)
        .eq('billable', true)
        .is('invoice_id', null)
        .not('ended_at', 'is', null)
        .gt('duration_seconds', 0),
    ]);

  const invoices = (invoicesRaw ?? []) as Array<{
    id: string;
    number: string;
    status: string;
    client_email: string;
    client_name: string | null;
    total_cents: number;
    currency: string;
    created_at: string;
    sent_at: string | null;
    paid_at: string | null;
    case_id: string | null;
    stripe_payment_link: string | null;
  }>;
  const unbilled = (unbilledRaw ?? []) as Array<{
    id: string;
    duration_seconds: number;
    rate_cents: number | null;
    case_id: string | null;
    billable: boolean;
  }>;

  const allInvoiceTotals = (allInvoiceTotalsRaw ?? []) as Array<{
    status: string;
    total_cents: number;
  }>;
  const totals = allInvoiceTotals.reduce(
    (acc, i) => {
      if (i.status === 'sent') acc.outstanding += i.total_cents;
      if (i.status === 'paid') acc.collected += i.total_cents;
      return acc;
    },
    { outstanding: 0, collected: 0 },
  );

  const unbilledTotal = unbilled.reduce(
    (sum, e) =>
      sum + Math.round((e.rate_cents ?? 0) * (e.duration_seconds / 3600)),
    0,
  );
  const unbilledByCaseEntries = new Map<string, number>();
  for (const e of unbilled) {
    if (!e.case_id) continue;
    const v = Math.round((e.rate_cents ?? 0) * (e.duration_seconds / 3600));
    unbilledByCaseEntries.set(
      e.case_id,
      (unbilledByCaseEntries.get(e.case_id) ?? 0) + v,
    );
  }
  const unbilledByCase = Array.from(unbilledByCaseEntries.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1"><T>Counsel · billing</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Billing</T>
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          <T>
            Invoices issued from this firm, plus billable time that&rsquo;s
            ready to invoice. Click into a case to draft an invoice from its
            unbilled time entries.
          </T>
        </p>
      </header>

      {/* Top stats */}
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Outstanding" value={fmtCents(totals.outstanding)} tone="amber" />
        <Stat label="Collected" value={fmtCents(totals.collected)} tone="emerald" />
        <Stat
          label="Unbilled time"
          value={fmtCents(unbilledTotal)}
          tone={unbilledTotal > 0 ? 'sky' : 'gray'}
        />
        <Stat
          label="Invoices"
          value={String(allInvoiceTotals.length)}
          tone="gray"
        />
      </section>

      {/* Unbilled time grouped by case */}
      {unbilledByCase.length > 0 && (
        <section className="card p-5 space-y-3">
          <p className="eyebrow"><T>Ready to invoice</T></p>
          <ul className="space-y-2">
            {unbilledByCase.map(([caseId, cents]) => (
              <li
                key={caseId}
                className="flex items-center justify-between gap-3 text-[13px]"
              >
                <Link
                  href={`/counsel/cases/${caseId}`}
                  className="text-forest-900 dark:text-cream-100 underline"
                >
                  <T>Case</T> {caseId.slice(0, 8)}...
                </Link>
                <span className="font-mono tabular-nums text-forest-900 dark:text-cream-100 font-semibold">
                  {fmtCents(cents)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
            <T>
              Invoices are drafted from the case detail page so the engagement
              scope and client get filled in automatically.
            </T>
          </p>
        </section>
      )}

      {/* Invoices list */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          <T>Recent invoices</T>
        </h2>
        {allInvoiceTotals.length > invoices.length && (
          <p className="text-[12px] text-ink-600 dark:text-cream-100/70">
            <T>Showing the</T> {invoices.length} <T>most recent of</T>{' '}
            {allInvoiceTotals.length}. <T>The totals above cover all of them.</T>
          </p>
        )}
        {invoices.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-[15px] text-forest-900 dark:text-cream-100">
              <T>No invoices issued yet.</T>
            </p>
            <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-1">
              <T>Open a case with billable time and use &ldquo;Draft invoice&rdquo;.</T>
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {invoices.map((i) => {
              const tone = STATUS_TONE[i.status] ?? STATUS_TONE.draft;
              return (
                <li
                  key={i.id}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-forest-900 dark:text-cream-100">
                        {i.number}
                      </p>
                      <span
                        className={`inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
                      >
                        {i.status}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 truncate">
                      {i.client_name ?? i.client_email} ·{' '}
                      {new Date(i.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    <p className="font-mono tabular-nums text-forest-900 dark:text-cream-100 font-semibold">
                      {fmtCents(i.total_cents)}
                    </p>
                    {/* Raw, live Stripe payment URL. ExternalLink routes
                        through @capacitor/browser, which is an IN-APP
                        SFSafariViewController on iOS, so a payment could be
                        completed without ever leaving the app process. Even
                        though this is firm-to-client invoicing for
                        professional services rather than digital goods, an
                        unguarded Stripe checkout opening inside the app is
                        indefensible under Guideline 3.1.1, so it is removed
                        from the iOS render entirely (server signal) and
                        carries data-hide-on-ios as the second signal. The
                        invoice stays fully visible and the firm can still
                        send it by email from the row actions. */}
                    {i.status === 'sent' && i.stripe_payment_link && !isIos && (
                      <ExternalLink
                        data-hide-on-ios
                        href={i.stripe_payment_link}
                        className="text-[11px] underline text-forest-900 dark:text-cream-100"
                      >
                        <T>Pay link</T>
                      </ExternalLink>
                    )}
                    {i.status === 'draft' && (
                      <SendInvoiceButton
                        invoiceId={i.id}
                        clientEmail={i.client_email}
                      />
                    )}
                    {i.status !== 'paid' && i.status !== 'void' && (
                      <MarkPaidButton invoiceId={i.id} />
                    )}
                    {(i.status === 'draft' || i.status === 'sent') && (
                      <InvoiceRowActions
                        firmId={ctx.firm.id}
                        invoiceId={i.id}
                        status={i.status}
                      />
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
  tone,
}: {
  label: string;
  value: string;
  tone: 'gray' | 'sky' | 'amber' | 'emerald';
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'emerald'
        ? 'text-emerald-700 dark:text-emerald-300'
        : tone === 'sky'
          ? 'text-sky-700 dark:text-sky-300'
          : 'text-cream-100/65';
  return (
    <div className="card p-5">
      <p className="eyebrow text-[10.5px] mb-2"><T>{label}</T></p>
      <p className={`font-display text-3xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
    </div>
  );
}
