import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Co-counsel referrals · Counsel · Advottic' };

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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Counsel · referrals</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Co-counsel referrals
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Refer a matter to another firm with an agreed fee split, or
            accept a referral from a firm that&rsquo;s out of its depth.
            Client consent in writing is required by Model Rule 1.5(e) and
            most state analogues; the audit trail is captured on each row.
          </p>
        </div>
        <Link href="/counsel/referrals/new" className="btn-primary">
          Propose a referral
        </Link>
      </header>

      <Section title={`Inbound (${inbound.length})`}>
        {inbound.length === 0 ? (
          <Empty msg="No inbound referrals yet." />
        ) : (
          <Cards rows={inbound} firmMap={firmMap} viewerSide="inbound" />
        )}
      </Section>

      <Section title={`Outbound (${outbound.length})`}>
        {outbound.length === 0 ? (
          <Empty msg="You haven't referred anything out yet." />
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
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
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
        const tone = STATUS_TONE[r.status] ?? STATUS_TONE.proposed;
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
                  {viewerSide === 'inbound' ? 'From ' : 'To '} {otherName} · {r.state}
                </p>
                <span
                  className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
                >
                  {r.status}
                </span>
              </div>
              <p className="text-[12.5px] text-ink-600 dark:text-cream-100/75 line-clamp-2 leading-snug">
                {r.matter_summary}
              </p>
              <div className="flex items-center justify-between text-[11px] text-ink-400 dark:text-cream-100/45 font-mono tabular-nums pt-1 border-t border-ink-100 dark:border-forest-800/40">
                <span>{new Date(r.created_at).toLocaleDateString()}</span>
                <span>Split {r.proposed_split_percent}%</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
