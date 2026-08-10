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
export const metadata = { title: 'Billing · Counsel' };

/** One hex per invoice state; StatusPill derives fill and border from it. */
const STATUS_COLOR: Record<string, string> = {
  draft: PILL_COLORS.neutral,
  sent: PILL_COLORS.waiting,
  paid: PILL_COLORS.good,
  void: PILL_COLORS.flagged,
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
      <PageHeader
        eyebrow={<T>Counsel · billing</T>}
        title={<T>Billing</T>}
        subtitle={
          <T>
            Invoices issued from this firm, plus billable time that&rsquo;s
            ready to invoice. Click into a case to draft an invoice from its
            unbilled time entries.
          </T>
        }
      />

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

      {/* Unbilled time grouped by case. The header says how many of the
          cases with unbilled time are shown, because the list is the top
          five by value and used to say nothing about the rest. */}
      {unbilledByCase.length > 0 && (
        <PanelCard
          title={<T>Ready to invoice</T>}
          action={
            unbilledByCaseEntries.size > unbilledByCase.length ? (
              <p className="text-[12px] tabular-nums text-muted">
                {unbilledByCase.length} <T>of</T> {unbilledByCaseEntries.size}{' '}
                <T>cases, by value</T>
              </p>
            ) : (
              <p className="text-[12px] tabular-nums text-muted">
                {unbilledByCase.length}
              </p>
            )
          }
        >
          <ul className="space-y-2">
            {unbilledByCase.map(([caseId, cents]) => (
              <li
                key={caseId}
                className="flex items-center justify-between gap-3 text-[13px]"
              >
                <Link
                  href={`/counsel/cases/${caseId}`}
                  className="text-foreground underline"
                >
                  <T>Case</T> <MonoRef>{caseId.slice(0, 8)}</MonoRef>
                </Link>
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {fmtCents(cents)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            <T>
              Invoices are drafted from the case detail page so the engagement
              scope and client get filled in automatically.
            </T>
          </p>
        </PanelCard>
      )}

      {/* Invoices, on the list pattern's table. Every figure is the one
          that was there before, in the same units and under the same
          label; only the row geometry changed. */}
      {invoices.length === 0 ? (
        <EmptyState
          title={<T>No invoices issued yet.</T>}
          sub={
            <T>Open a case with billable time and use &ldquo;Draft invoice&rdquo;.</T>
          }
        />
      ) : (
        <PanelCard
          title={<T>Recent invoices</T>}
          bodyClassName=""
          action={
            allInvoiceTotals.length > invoices.length ? (
              <p className="text-[12px] text-muted">
                <T>Showing the</T> {invoices.length} <T>most recent of</T>{' '}
                {allInvoiceTotals.length}.{' '}
                <T>The totals above cover all of them.</T>
              </p>
            ) : (
              <p className="text-[12px] tabular-nums text-muted">
                {invoices.length}
              </p>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left">
              <thead className="border-b border-edge">
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                  <th scope="col" className="px-3 py-2"><T>Invoice</T></th>
                  <th scope="col" className="px-3 py-2"><T>Client</T></th>
                  <th scope="col" className="px-3 py-2"><T>Status</T></th>
                  <th scope="col" className="px-3 py-2 text-right"><T>Total</T></th>
                  <th scope="col" className="px-3 py-2"><T>Issued</T></th>
                  <th scope="col" className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const color = STATUS_COLOR[i.status] ?? STATUS_COLOR.draft;
                  return (
                    <tr
                      key={i.id}
                      className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                    >
                      <td className="px-3 py-2.5">
                        <MonoRef>{i.number}</MonoRef>
                      </td>
                      <td
                        className="max-w-[16rem] truncate px-3 py-2.5 text-[13px] text-foreground"
                        data-no-translate
                      >
                        {i.client_name ?? i.client_email}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill color={color} size="sm" dot>
                          {i.status}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums text-foreground">
                        {fmtCents(i.total_cents)}
                      </td>
                      <td
                        className="px-3 py-2.5 text-[12px] text-muted"
                        title={formatDateTimeNumeric(i.created_at)}
                        suppressHydrationWarning
                      >
                        {relativeTime(i.created_at) ?? ''}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-3">
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
                              className="text-[11px] underline text-foreground"
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
      <p className={`text-3xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
    </div>
  );
}
