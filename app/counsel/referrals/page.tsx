import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { referralStatusColor } from '@/lib/referral-status';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill } from '@/components/counsel/StatusPill';
import {
  PanelCard,
  MonoRef,
  shortRef,
  relativeTime,
} from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';
import { formatDateTimeNumeric } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Co-counsel referrals · Counsel' };

type ReferralRow = {
  id: string;
  referring_firm_id: string;
  referred_firm_id: string;
  matter_summary: string;
  proposed_split_percent: number;
  state: string;
  status: string;
  created_at: string;
};

/**
 * Referrals, on the list pattern from PARITY-SPEC.md section 3.
 *
 * Two cards rather than a segmented view strip. Inbound and outbound
 * are real subsets with real counts, but both are shown at once and a
 * strip would put one of them behind a tab: a referral waiting on this
 * firm's answer is exactly the thing that must not be hidden. The
 * counts sit in the card headers instead.
 *
 * What else is left out: no search, filters or sortable headers,
 * because nothing on this page narrows or reorders either list; and no
 * checkbox column, because there is no bulk action a set of referrals
 * can be put through.
 */
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

  const referrals = (referralsRaw ?? []) as ReferralRow[];

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
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · referrals</T>}
        title={<T>Co-counsel referrals</T>}
        subtitle={
          <>
            {inbound.length} <T>inbound and</T> {outbound.length}{' '}
            <T>outbound.</T>{' '}
            <T>Refer a matter to another firm with an agreed fee split, or
            accept a referral from a firm that&rsquo;s out of its depth.
            Client consent in writing is required by Model Rule 1.5(e) and
            most state analogues; the audit trail is captured on each row.</T>
          </>
        }
        action={
          <Link href="/counsel/referrals/new" className="btn-primary">
            <T>Propose a referral</T>
          </Link>
        }
      />

      <ReferralTable
        title={<T>Inbound</T>}
        empty={<T>No inbound referrals yet.</T>}
        rows={inbound}
        firmMap={firmMap}
        viewerSide="inbound"
      />

      <ReferralTable
        title={<T>Outbound</T>}
        empty={<T>You have not referred anything out yet.</T>}
        rows={outbound}
        firmMap={firmMap}
        viewerSide="outbound"
      />
    </div>
  );
}

function ReferralTable({
  title,
  empty,
  rows,
  firmMap,
  viewerSide,
}: {
  title: React.ReactNode;
  empty: React.ReactNode;
  rows: ReferralRow[];
  firmMap: Map<string, string>;
  viewerSide: 'inbound' | 'outbound';
}) {
  if (rows.length === 0) {
    return (
      <PanelCard title={title}>
        <p className="text-[13px] italic text-muted">{empty}</p>
      </PanelCard>
    );
  }
  return (
    <PanelCard
      title={title}
      bodyClassName=""
      action={
        <p className="text-[12px] tabular-nums text-muted">{rows.length}</p>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <thead className="border-b border-edge">
            <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
              <th scope="col" className="px-3 py-2">
                {viewerSide === 'inbound' ? <T>From</T> : <T>To</T>}
              </th>
              <th scope="col" className="px-3 py-2"><T>Referral</T></th>
              <th scope="col" className="px-3 py-2"><T>State</T></th>
              <th scope="col" className="px-3 py-2"><T>Status</T></th>
              <th scope="col" className="px-3 py-2 text-right"><T>Split</T></th>
              <th scope="col" className="px-3 py-2"><T>Created</T></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const otherFirmId =
                viewerSide === 'inbound'
                  ? r.referring_firm_id
                  : r.referred_firm_id;
              const otherName = firmMap.get(otherFirmId);
              return (
                <tr
                  key={r.id}
                  className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                >
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/counsel/referrals/${r.id}`}
                      prefetch={false}
                      className="block min-w-0 max-w-[20rem]"
                    >
                      {otherName ? (
                        <span
                          className="block truncate text-[13.5px] font-semibold text-foreground"
                          data-no-translate
                        >
                          {otherName}
                        </span>
                      ) : (
                        <span className="block truncate text-[13.5px] font-semibold text-foreground">
                          <T>Other firm</T>
                        </span>
                      )}
                      <span
                        className="block truncate text-[11.5px] text-muted"
                        data-no-translate
                      >
                        {r.matter_summary}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <MonoRef title={r.id}>{shortRef(r.id)}</MonoRef>
                  </td>
                  <td
                    className="px-3 py-2.5 text-[12.5px] text-muted"
                    data-no-translate
                  >
                    {r.state}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill size="sm" dot color={referralStatusColor(r.status)}>
                      {r.status}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-foreground">
                    {r.proposed_split_percent}%
                  </td>
                  <td
                    className="px-3 py-2.5 text-[12px] text-muted"
                    title={formatDateTimeNumeric(r.created_at)}
                    suppressHydrationWarning
                  >
                    {relativeTime(r.created_at) ?? ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PanelCard>
  );
}
