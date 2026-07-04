import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { RespondToReferralForm } from './respond-form';
import { RecordPaymentForm } from './record-payment-form';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Referral · Counsel' };

const STATUS_TONE: Record<string, string> = {
  proposed:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  accepted:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  declined:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  closed:
    'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  withdrawn:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
};

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

  const tone = STATUS_TONE[r.status] ?? STATUS_TONE.proposed;

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/referrals"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          <T>&larr; Referrals</T>
        </Link>
      </p>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1"><T>Referral</T></p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {names.get(r.referring_firm_id)} &rarr;{' '}
            {names.get(r.referred_firm_id)}
          </h1>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
            {r.state} · <T>proposed split</T> {r.proposed_split_percent}% ·{' '}
            <T>created</T>{' '}
            {new Date(r.created_at).toLocaleString()}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
        >
          {r.status}
        </span>
      </header>

      <section className="card p-5 space-y-2">
        <p className="eyebrow text-[10px]"><T>Matter brief</T></p>
        <p className="text-[14px] text-ink-800 dark:text-cream-100/90 leading-relaxed whitespace-pre-wrap">
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
              <p className="text-[12px] text-ink-600 dark:text-cream-100/70 font-mono">
                <T>Consent recorded</T>{' '}
                {new Date(r.client_consent_at).toLocaleString()}
              </p>
            )}
            {r.client_consent_audit && (
              <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap">
                {r.client_consent_audit}
              </p>
            )}
          </section>

          <section className="grid sm:grid-cols-2 gap-3">
            <div className="card p-5">
              <p className="eyebrow text-[10px] mb-2">
                <T>Referring firm received</T>
              </p>
              <p className="font-display text-2xl font-medium text-forest-900 dark:text-cream-100 tabular-nums">
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
              <p className="font-display text-2xl font-medium text-forest-900 dark:text-cream-100 tabular-nums">
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
