import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmSurfaceSettings } from '@/lib/firm-settings';
import { createServerSupabase } from '@/lib/supabase/server';
import { RespondToReferralForm } from './respond-form';
import { RecordPaymentForm } from './record-payment-form';
import { referralStatusColor } from '@/lib/referral-status';
import { StatusPill } from '@/components/counsel/StatusPill';
import {
  PanelCard,
  Chip,
  MonoRef,
  shortRef,
  relativeTime,
} from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';
import { formatDateTimeNumeric } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Referral · Counsel' };

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export default async function ReferralDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  // Leads and referrals are one surface, and a workspace that does not have
  // it does not have this page. Same shape as the Time / Billing / Trust
  // guards: the rail dropping the link is a courtesy, this is the refusal.
  if ((await getFirmSurfaceSettings(ctx.firm.id)).hideGrowth) {
    redirect('/counsel');
  }
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('cocounsel_referrals')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as {
    id: string;
    referring_firm_id: string;
    referred_firm_id: string;
    matter_summary: string;
    proposed_split_percent: number;
    state: string;
    status: string;
    client_consent_at: string | null;
    client_consent_audit: string | null;
    total_fee_cents: number | null;
    referring_paid_cents: number;
    referred_paid_cents: number;
    created_at: string;
  };

  const isReferring = r.referring_firm_id === ctx.firm.id;
  const isReferred = r.referred_firm_id === ctx.firm.id;
  if (!isReferring && !isReferred) notFound();

  const { data: firmRows } = await supabase
    .from('firms')
    .select('id, name')
    .in('id', [r.referring_firm_id, r.referred_firm_id]);
  const names = new Map(
    ((firmRows ?? []) as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]),
  );

  return (
    /*
      The detail pattern from PARITY-SPEC.md section 3: breadcrumb with
      a mono reference, title, meta chip row, then cards with uppercase
      letterspaced headers.

      No action bar, and no aside column. The action bar is a row of
      controls that change the record in place, and this record has
      none: responding to a referral and recording a payment are both
      multi-field forms that already frame themselves, and they appear
      only in the one state each applies to. There is no related-record
      list to put in an aside either - a referral points at two firms
      and nothing else.
    */
    <div className="space-y-6 animate-fade-up">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        <Link
          href="/counsel/referrals"
          className="text-muted transition-colors hover:text-foreground"
        >
          <T>Referrals</T>
        </Link>
        <span aria-hidden className="text-muted">
          /
        </span>
        <MonoRef title={r.id}>{shortRef(r.id)}</MonoRef>
      </nav>

      <header className="min-w-0">
        <h1
          className="break-words text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-3xl"
          data-no-translate
        >
          {names.get(r.referring_firm_id)} &rarr;{' '}
          {names.get(r.referred_firm_id)}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <StatusPill dot color={referralStatusColor(r.status)}>
            {r.status}
          </StatusPill>
          <Chip>
            <span data-no-translate>{r.state}</span>
          </Chip>
          <Chip tone="accent">
            <T>Proposed split</T> {r.proposed_split_percent}%
          </Chip>
        </div>
        <p className="mt-2 text-[12px] text-muted" suppressHydrationWarning>
          <T>created</T> {relativeTime(r.created_at)}
        </p>
      </header>

      <PanelCard title={<T>Matter brief</T>}>
        <p
          className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground"
          data-no-translate
        >
          {r.matter_summary}
        </p>
      </PanelCard>

      {r.status === 'proposed' && isReferred && (
        <RespondToReferralForm firmId={ctx.firm.id} referralId={r.id} />
      )}

      {r.status === 'accepted' && (
        <>
          <PanelCard
            title={<T>Accepted · client consent on file</T>}
            className="ring-1 ring-emerald-300/40 dark:ring-emerald-700/40"
          >
            {r.client_consent_at && (
              <p className="font-mono text-[12px] text-muted">
                <T>Consent recorded</T>{' '}
                {formatDateTimeNumeric(r.client_consent_at)}
              </p>
            )}
            {r.client_consent_audit && (
              <p
                className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground"
                data-no-translate
              >
                {r.client_consent_audit}
              </p>
            )}
          </PanelCard>

          {/* Both amounts keep their label and their units. The card
              header carries the label the eyebrow used to. */}
          <section className="grid gap-3 sm:grid-cols-2">
            <PanelCard title={<T>Referring firm received</T>}>
              <p className="text-2xl font-medium tabular-nums text-foreground">
                {fmtCents(r.referring_paid_cents)}
              </p>
              {isReferring && (
                <RecordPaymentForm
                  firmId={ctx.firm.id}
                  referralId={r.id}
                  side="referring"
                  current={r.referring_paid_cents}
                />
              )}
            </PanelCard>
            <PanelCard title={<T>Referred firm received</T>}>
              <p className="text-2xl font-medium tabular-nums text-foreground">
                {fmtCents(r.referred_paid_cents)}
              </p>
              {isReferred && (
                <RecordPaymentForm
                  firmId={ctx.firm.id}
                  referralId={r.id}
                  side="referred"
                  current={r.referred_paid_cents}
                />
              )}
            </PanelCard>
          </section>
        </>
      )}
    </div>
  );
}
