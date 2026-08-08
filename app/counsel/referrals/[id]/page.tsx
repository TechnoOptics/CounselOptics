import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { RespondToReferralForm } from './respond-form';
import { RecordPaymentForm } from './record-payment-form';
import { referralStatusColor } from '@/lib/referral-status';
import { StatusPill } from '@/components/counsel/StatusPill';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

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
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/referrals"
          className="text-muted hover:text-foreground"
        >
          <T>&larr; Referrals</T>
        </Link>
      </p>

      <PageHeader
        align="start"
        eyebrow={<T>Referral</T>}
        title={
          <>
            {names.get(r.referring_firm_id)} &rarr;{' '}
            {names.get(r.referred_firm_id)}
          </>
        }
        meta={
          <>
            {r.state} · <T>proposed split</T> {r.proposed_split_percent}% ·{' '}
            <T>created</T>{' '}
            {new Date(r.created_at).toLocaleString()}
          </>
        }
        action={
          <StatusPill color={referralStatusColor(r.status)}>
            {r.status}
          </StatusPill>
        }
      />

      <section className="card p-5 space-y-2">
        <p className="eyebrow text-[10px]"><T>Matter brief</T></p>
        <p className="text-[14px] text-foreground leading-relaxed whitespace-pre-wrap">
          {r.matter_summary}
        </p>
      </section>

      {r.status === 'proposed' && isReferred && (
        <RespondToReferralForm firmId={ctx.firm.id} referralId={r.id} />
      )}

      {r.status === 'accepted' && (
        <>
          <section className="card p-5 ring-1 ring-emerald-300/40 dark:ring-emerald-700/40 bg-emerald-50/30 dark:bg-emerald-950/20 space-y-2">
            <p className="eyebrow text-emerald-700 dark:text-emerald-300">
              <T>Accepted · client consent on file</T>
            </p>
            {r.client_consent_at && (
              <p className="text-[12px] text-muted font-mono">
                <T>Consent recorded</T>{' '}
                {new Date(r.client_consent_at).toLocaleString()}
              </p>
            )}
            {r.client_consent_audit && (
              <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
                {r.client_consent_audit}
              </p>
            )}
          </section>

          <section className="grid sm:grid-cols-2 gap-3">
            <div className="card p-5">
              <p className="eyebrow text-[10px] mb-2">
                <T>Referring firm received</T>
              </p>
              <p className="text-2xl font-medium text-foreground tabular-nums">
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
            </div>
            <div className="card p-5">
              <p className="eyebrow text-[10px] mb-2"><T>Referred firm received</T></p>
              <p className="text-2xl font-medium text-foreground tabular-nums">
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
            </div>
          </section>
        </>
      )}
    </div>
  );
}
