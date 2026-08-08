import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { referralStatusColor } from '@/lib/referral-status';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Co-counsel referrals · Counsel' };

export default async function CocounselReferralsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();

  const { data: referralsRaw } = await supabase
    .from('cocounsel_referrals')
    .select(
      'id, referring_firm_id, referred_firm_id, matter_summary, proposed_split_percent, state, status, created_at',
    )
    .or(
      `referring_firm_id.eq.${ctx.firm.id},referred_firm_id.eq.${ctx.firm.id}`,
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const referrals = (referralsRaw ?? []) as Array<{
    id: string;
    referring_firm_id: string;
    referred_firm_id: string;
    matter_summary: string;
    proposed_split_percent: number;
    state: string;
    status: string;
    created_at: string;
  }>;

  // Hydrate firm names.
  const firmIds = Array.from(
    new Set(
      referrals.flatMap((r) => [r.referring_firm_id, r.referred_firm_id]),
    ),
  );
  const firmMap = new Map<string, string>();
  if (firmIds.length > 0) {
    const { data: firms } = await supabase
      .from('firms')
      .select('id, name')
      .in('id', firmIds);
    for (const f of (firms ?? []) as Array<{ id: string; name: string }>) {
      firmMap.set(f.id, f.name);
    }
  }

  const inbound = referrals.filter(
    (r) => r.referred_firm_id === ctx.firm.id,
  );
  const outbound = referrals.filter(
    (r) => r.referring_firm_id === ctx.firm.id,
  );

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · referrals</T>}
        title={<T>Co-counsel referrals</T>}
        subtitle={
          <T>Refer a matter to another firm with an agreed fee split, or
          accept a referral from a firm that&rsquo;s out of its depth.
          Client consent in writing is required by Model Rule 1.5(e) and
          most state analogues; the audit trail is captured on each row.</T>
        }
        action={
          <Link href="/counsel/referrals/new" className="btn-primary">
            <T>Propose a referral</T>
          </Link>
        }
      />

      <Section
        title={
          <>
            <T>Inbound</T> ({inbound.length})
          </>
        }
      >
        {inbound.length === 0 ? (
          <Empty msg={<T>No inbound referrals yet.</T>} />
        ) : (
          <Cards rows={inbound} firmMap={firmMap} viewerSide="inbound" />
        )}
      </Section>

      <Section
        title={
          <>
            <T>Outbound</T> ({outbound.length})
          </>
        }
      >
        {outbound.length === 0 ? (
          <Empty msg={<T>You haven't referred anything out yet.</T>} />
        ) : (
          <Cards rows={outbound} firmMap={firmMap} viewerSide="outbound" />
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: React.ReactNode }) {
  return (
    <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
      {msg}
    </p>
  );
}

function Cards({
  rows,
  firmMap,
  viewerSide,
}: {
  rows: Array<{
    id: string;
    referring_firm_id: string;
    referred_firm_id: string;
    matter_summary: string;
    proposed_split_percent: number;
    state: string;
    status: string;
    created_at: string;
  }>;
  firmMap: Map<string, string>;
  viewerSide: 'inbound' | 'outbound';
}) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const otherFirmId =
          viewerSide === 'inbound' ? r.referring_firm_id : r.referred_firm_id;
        const otherName = firmMap.get(otherFirmId) ?? 'Other firm';
        return (
          <li
            key={r.id}
            className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
          >
            <Link href={`/counsel/referrals/${r.id}`} className="block space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                  {viewerSide === 'inbound' ? <T>From</T> : <T>To</T>} {otherName} · {r.state}
                </p>
                <StatusPill size="sm" color={referralStatusColor(r.status)}>
                  {r.status}
                </StatusPill>
              </div>
              <p className="text-[12.5px] text-ink-600 dark:text-cream-100/75 line-clamp-2 leading-snug">
                {r.matter_summary}
              </p>
              <div className="flex items-center justify-between text-[11px] text-ink-500 dark:text-cream-100/70 font-mono tabular-nums pt-1 border-t border-ink-100 dark:border-forest-800/40">
                <span>{new Date(r.created_at).toLocaleDateString()}</span>
                <span><T>Split</T> {r.proposed_split_percent}%</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
