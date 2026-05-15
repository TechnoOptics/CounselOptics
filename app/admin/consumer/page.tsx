import Link from 'next/link';
import { adminGetCounts, adminListFeedback } from '@/lib/storage';
import { adminGetHqDashboardCounts } from '@/lib/hq-storage';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Consumer overview · Advottic HQ' } };

/**
 * Consumer perspective overview. Surfaces the signals an admin needs
 * when supporting individual users: who's signed up, who's paying,
 * what's going wrong, and what cases are flowing through.
 */
export default async function HqConsumerOverviewPage() {
  const [counts, hq, recentFeedback] = await Promise.all([
    adminGetCounts(),
    adminGetHqDashboardCounts(),
    adminListFeedback({ status: 'all' }),
  ]);

  const openFeedback = recentFeedback.filter((f) => f.status !== 'resolved').slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow text-sky-300">Personal Advottic</p>
        <h2 className="font-display text-2xl tracking-[-0.01em] text-cream-100">
          Consumer overview
        </h2>
        <p className="text-[13px] text-cream-100/65 mt-1 max-w-2xl">
          The cockpit for individual users. Watch sign-ups and subscriptions, jump
          into the user search, review every case, and triage feedback as it lands.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total users" value={hq.consumer.users} href="/admin/users" />
        <Stat
          label="Active subscriptions"
          value={hq.consumer.activeSubs}
          tone={hq.consumer.activeSubs > 0 ? 'good' : 'neutral'}
        />
        <Stat
          label="Past-due / unpaid"
          value={hq.consumer.pastDueSubs}
          tone={hq.consumer.pastDueSubs > 0 ? 'warn' : 'neutral'}
          href="/admin/users"
        />
        <Stat label="Cases" value={counts.cases} href="/admin/cases" />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Exhibits" value={counts.exhibits} subdued />
        <Stat label="Document reviews" value={counts.reviews} subdued />
        <Stat
          label="Open feedback"
          value={hq.consumer.feedbackOpen}
          tone={hq.consumer.feedbackOpen > 0 ? 'warn' : 'neutral'}
          href="/admin/feedback"
        />
      </section>

      {openFeedback.length > 0 && (
        <section className="space-y-3">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow text-cream-100/70">Recent open feedback</p>
            <Link
              href="/admin/feedback"
              className="text-[12px] text-cream-100/65 hover:text-cream-100 underline underline-offset-2"
            >
              See all
            </Link>
          </header>
          {/*
            Audit W20 V3 CR-41: each feedback row now surfaces an
            "age" pill that goes amber after 3 business days and
            rose after 7. The triage SLA is "respond or resolve
            within 3 business days for bugs, 7 for feature
            requests" - the visual makes a stale queue
            self-evident to anyone scanning HQ.
          */}
          <ul className="space-y-2">
            {openFeedback.map((f) => {
              const ageMs = Date.now() - Date.parse(f.createdAt);
              const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
              const stale = ageDays >= 7;
              const aging = !stale && ageDays >= 3;
              return (
                <li key={f.id} className="card p-4">
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <p className="text-[12px] uppercase tracking-wider font-semibold text-cream-100/60">
                      {f.category} · {f.status}
                    </p>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={
                          stale
                            ? 'inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-rose-400/15 ring-1 ring-rose-300/40 text-rose-200'
                            : aging
                              ? 'inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 text-amber-200'
                              : 'inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-cream-100/10 ring-1 ring-cream-100/15 text-cream-100/60'
                        }
                        title={`Open ${ageDays} day${ageDays === 1 ? '' : 's'}`}
                      >
                        {ageDays === 0 ? 'Today' : `${ageDays}d open`}
                      </span>
                      <p className="text-[11px] text-cream-100/45 font-mono tabular-nums">
                        {new Date(f.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <p className="text-[13px] text-cream-100/85 line-clamp-2">{f.body}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <ActionCard
          title="Search & support users"
          summary="Find someone by name or email, see their plan and case count, toggle admin or block on the row."
          href="/admin/users"
        />
        <ActionCard
          title="Browse all cases"
          summary="Every case in the system, sortable by representation status."
          href="/admin/cases"
        />
        <ActionCard
          title="Triage feedback"
          summary="Bug reports and feature requests with status filters."
          href="/admin/feedback"
        />
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  tone = 'neutral',
  subdued = false,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: 'neutral' | 'good' | 'warn';
  subdued?: boolean;
}) {
  const numberTone =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : 'text-cream-100';
  const inner = (
    <div
      className={`card p-5 transition-colors ${
        subdued ? 'opacity-80 hover:opacity-100' : 'hover:ring-white/15'
      }`}
    >
      <p className="eyebrow text-cream-100/55 mb-1.5">{label}</p>
      <p className={`text-3xl font-semibold tracking-tight tabular-nums ${numberTone}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionCard({
  title,
  summary,
  href,
}: {
  title: string;
  summary: string;
  href: string;
}) {
  return (
    <Link href={href} className="card p-5 hover:ring-sky-500/30 transition-all block">
      <p className="font-semibold text-cream-100 text-[14px]">{title}</p>
      <p className="text-[12.5px] text-cream-100/65 mt-1.5 leading-relaxed">{summary}</p>
      <p className="text-[12px] text-sky-300 font-semibold mt-3">Open →</p>
    </Link>
  );
}
