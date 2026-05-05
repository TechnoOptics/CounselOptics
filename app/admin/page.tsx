import Link from 'next/link';
import { adminGetHqDashboardCounts, adminGetLiveHealth } from '@/lib/hq-storage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Advottic HQ' };

/**
 * HQ landing - the premium executive dashboard. Just two hero
 * numbers (Users / Businesses), a one-line system-health pill, a
 * compact crash-reports button, and a "pick your side" choice
 * between Consumer and Counsel administration. Drilling into either
 * side opens its own tailored overview at /admin/consumer or
 * /admin/counsel.
 */
export default async function HqLandingPage() {
  const [counts, live] = await Promise.all([
    adminGetHqDashboardCounts(),
    adminGetLiveHealth(),
  ]);

  return (
    <div className="space-y-10 animate-fade-up">
      <section className="grid gap-4 sm:grid-cols-2">
        <HeroStat
          label="Personal users"
          value={counts.consumer.users}
          subline="People using Advottic for their own legal matters"
          accent="cool"
        />
        <HeroStat
          label="Businesses on Counsel"
          value={counts.counsel.firms}
          subline="Firms, in-house teams, and government counsel"
          accent="warm"
        />
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <LiveSupabasePill live={live} />
        <SecurityPulsePill />
        <CrashButton count={counts.ops.crashOpen} />
        {(counts.consumer.pastDueSubs > 0 || counts.counsel.expiredGrants > 0) && (
          <span className="text-[12px] text-amber-300/85 px-3 py-1.5 rounded-md bg-amber-950/40 ring-1 ring-amber-700/40">
            {counts.consumer.pastDueSubs > 0 &&
              `${counts.consumer.pastDueSubs} subscription${counts.consumer.pastDueSubs === 1 ? '' : 's'} past due`}
            {counts.consumer.pastDueSubs > 0 && counts.counsel.expiredGrants > 0 && ' · '}
            {counts.counsel.expiredGrants > 0 &&
              `${counts.counsel.expiredGrants} expired invitation${counts.counsel.expiredGrants === 1 ? '' : 's'}`}
          </span>
        )}
        {live.cronSnapshotStale && (
          <span className="text-[12px] text-amber-300/85 px-3 py-1.5 rounded-md bg-amber-950/40 ring-1 ring-amber-700/40">
            Hourly cron is not firing - investigate
          </span>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <p className="eyebrow text-cream-100/70">Choose what to administrate</p>
          <h2 className="font-display text-xl text-cream-100 mt-0.5">
            Where would you like to focus?
          </h2>
          <p className="text-[13px] text-cream-100/60 mt-1 max-w-2xl">
            HQ tailors itself to one side at a time. Pick the lens you need now;
            you can always switch from the top header.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <PerspectiveCard
            title="Consumer"
            tag="Personal Advottic"
            summary="Help individuals using Advottic for their own legal matters. Search users, support open feedback, watch subscription health, and review case activity."
            href="/admin/consumer"
            ctaLabel="Administer consumer"
            highlights={[
              { label: 'Total users', value: counts.consumer.users },
              { label: 'Active subscriptions', value: counts.consumer.activeSubs },
              { label: 'Open feedback', value: counts.consumer.feedbackOpen },
            ]}
            accent="cool"
          />
          <PerspectiveCard
            title="Counsel"
            tag="Organizational workspace"
            summary="Support firms and in-house teams on Advottic Counsel. Review applications, dispatch outbound invitations, monitor billing, and triage feature requests."
            href="/admin/counsel"
            ctaLabel="Administer counsel"
            highlights={[
              { label: 'Active firms', value: counts.counsel.firms },
              { label: 'Pending requests', value: counts.counsel.pendingRequests },
              { label: 'Outstanding invites', value: counts.counsel.pendingGrants },
            ]}
            accent="warm"
          />
        </div>
      </section>

      <ScopePanel />

      <p className="text-[11px] text-cream-100/45 italic">
        Numbers refresh on every page load. The Supabase pill at the top runs a
        live database + auth probe at request time, so it never lies even when
        the hourly cron is broken.
      </p>
    </div>
  );
}

/**
 * Platform-scope memo. Operators glance at this before answering
 * "does Advottic do X yet?" - keeps the gap between what's marketed
 * and what's actually shipping clear at a glance. Update the items
 * here when a row migrates from "coming" to "v1" or vice versa.
 */
function ScopePanel() {
  type ScopeItem = {
    title: string;
    state: 'preview' | 'polled' | 'stub' | 'limited' | 'live';
    body: string;
  };
  const items: ScopeItem[] = [
    {
      title: 'E-signature',
      state: 'preview',
      body:
        'Audit trail lives: each request records the document SHA-256, every link view + signature appends to a tamper-evident hash chain (firm_signature_events), and /api/firm/sign/audit-trail/{id} surfaces the chain to firm members. Output PDFs stay watermarked "DRAFT - NOT LEGALLY BINDING" until an attorney has reviewed this implementation against UETA / E-SIGN for the relying party\'s jurisdiction.',
    },
    {
      title: 'Team chat',
      state: 'live',
      body:
        'Real-time via Supabase WebSockets. Messages, edits, and deletes propagate to every channel member within ~100ms; a 60s heartbeat refetch covers any dropped event.',
    },
    {
      title: 'MS 365 + Zoom integrations',
      state: 'preview',
      body:
        'OAuth handshake + encrypted token storage are live. Connect from /counsel/meetings once the developer-portal apps are registered and MICROSOFT_CLIENT_ID / ZOOM_CLIENT_ID are set in Vercel env. Scheduling-from-case + meeting auto-link in chat ship next.',
    },
    {
      title: 'Bella in firm mode',
      state: 'live',
      body:
        'Issue-spots in the firm’s jurisdiction + practice areas, and pulls real citations from CourtListener (free public-domain federal + state opinions). Not a Westlaw / Lexis substitute - no KeyCite or Shepard’s - so Bella always reminds the user to verify a case is still good law.',
    },
  ];
  return (
    <section className="card p-6 space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow text-cream-100/70">Platform scope</p>
          <h2 className="font-display text-xl text-cream-100 mt-0.5">
            What ships in v1, what&rsquo;s coming
          </h2>
        </div>
        <p className="text-[11px] text-cream-100/45 hidden sm:block">
          Operator memo &middot; updated per release
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <li
            key={it.title}
            className="rounded-lg p-4 ring-1 ring-white/5 bg-black/20 space-y-1.5"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13px] font-semibold text-cream-100">
                {it.title}
              </p>
              <ScopeStateBadge state={it.state} />
            </div>
            <p className="text-[12.5px] text-cream-100/70 leading-relaxed">
              {it.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScopeStateBadge({
  state,
}: {
  state: 'preview' | 'polled' | 'stub' | 'limited' | 'live';
}) {
  const tone =
    state === 'live'
      ? 'bg-emerald-950/50 ring-emerald-500/50 text-emerald-100'
      : state === 'preview'
        ? 'bg-amber-950/40 ring-amber-700/40 text-amber-200'
        : state === 'polled'
          ? 'bg-sky-950/40 ring-sky-700/40 text-sky-200'
          : state === 'stub'
            ? 'bg-rose-950/40 ring-rose-700/40 text-rose-200'
            : 'bg-emerald-950/40 ring-emerald-700/40 text-emerald-200';
  const label =
    state === 'live'
      ? 'Live'
      : state === 'preview'
        ? 'Preview'
        : state === 'polled'
          ? 'Polled'
          : state === 'stub'
            ? 'Stub'
            : 'Limited';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.16em] ring-1 ${tone}`}
    >
      {label}
    </span>
  );
}

function HeroStat({
  label,
  value,
  subline,
}: {
  label: string;
  value: number;
  subline: string;
  accent?: 'cool' | 'warm';
}) {
  return (
    <div className="card p-7 transition-colors">
      <p className="eyebrow text-cream-100/65">{label}</p>
      <p className="mt-3 font-display text-6xl font-medium tracking-[-0.03em] tabular-nums text-gold-flow">
        {value.toLocaleString()}
      </p>
      <p className="text-[13px] text-cream-100/65 mt-2">{subline}</p>
    </div>
  );
}

function LiveSupabasePill({
  live,
}: {
  live: Awaited<ReturnType<typeof adminGetLiveHealth>>;
}) {
  const tone = live.ok
    ? 'bg-emerald-950/40 ring-emerald-700/40 text-emerald-200'
    : 'bg-rose-950/40 ring-rose-700/40 text-rose-200';
  const dot = live.ok ? 'bg-emerald-400' : 'bg-rose-400';
  const label = live.ok
    ? 'Supabase live'
    : live.probes.find((p) => p.status === 'fail')?.error ?? 'Supabase unreachable';
  return (
    <Link
      href="/admin/health"
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 text-[12.5px] transition-colors ${tone}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${dot} ${live.ok ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      <span>{label}</span>
      <span className="text-cream-100/55 font-mono text-[11px]">
        · {live.totalLatencyMs}ms
      </span>
    </Link>
  );
}

/**
 * Compact link to the live Security pulse dashboard. Renders as a
 * shield-style pill so operators can jump to the full readout from
 * any HQ surface. The actual posture (green/amber/red) is computed
 * inside /admin/security; this pill is just the entry point.
 */
function SecurityPulsePill() {
  return (
    <Link
      href="/admin/security"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 text-[12.5px] bg-emerald-950/30 ring-emerald-700/30 text-emerald-200 hover:text-emerald-100 transition-colors"
    >
      <span className="relative inline-flex h-2 w-2">
        <span
          className="animate-ping absolute inset-0 rounded-full opacity-75 bg-emerald-400"
          style={{ animationDuration: '2.5s' }}
          aria-hidden
        />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
      <span>Security pulse</span>
    </Link>
  );
}

function CrashButton({ count }: { count: number }) {
  const tone =
    count === 0
      ? 'bg-white/5 ring-white/10 text-cream-100/55 hover:text-cream-100/80'
      : 'bg-rose-950/40 ring-rose-700/40 text-rose-200 hover:text-rose-100';
  return (
    <Link
      href="/admin/crashes"
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 text-[12.5px] transition-colors ${tone}`}
    >
      <span aria-hidden>{count === 0 ? '○' : '●'}</span>
      <span>
        {count === 0
          ? 'No crash reports'
          : `Crash reports (${count.toLocaleString()})`}
      </span>
    </Link>
  );
}

function PerspectiveCard({
  title,
  tag,
  summary,
  href,
  ctaLabel,
  highlights,
  accent,
}: {
  title: string;
  tag: string;
  summary: string;
  href: string;
  ctaLabel: string;
  highlights: { label: string; value: number }[];
  accent: 'cool' | 'warm';
}) {
  const ring =
    accent === 'cool' ? 'hover:ring-sky-500/40' : 'hover:ring-amber-500/40';
  const tagColor =
    accent === 'cool' ? 'text-sky-300' : 'text-amber-300';
  return (
    <Link
      href={href}
      className={`card p-6 ring-1 ring-white/5 transition-all hover:translate-y-[-1px] ${ring} block`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className={`eyebrow ${tagColor}`}>{tag}</p>
          <h3 className="font-display text-2xl mt-0.5 text-gold-flow">{title}</h3>
        </div>
        <span className="text-cream-100/55 text-sm" aria-hidden>
          →
        </span>
      </div>
      <p className="text-[13px] text-cream-100/65 mt-3 leading-relaxed">{summary}</p>
      <dl className="mt-5 grid grid-cols-3 gap-3 pt-4 border-t border-white/5">
        {highlights.map((h) => (
          <div key={h.label}>
            <dd className="font-display text-2xl font-medium text-cream-100 tabular-nums">
              {h.value.toLocaleString()}
            </dd>
            <dt className="text-[11px] uppercase tracking-wider text-cream-100/55 mt-1">
              {h.label}
            </dt>
          </div>
        ))}
      </dl>
      <p
        className={`mt-5 inline-flex items-center gap-1 text-[13px] font-semibold ${
          accent === 'cool' ? 'text-sky-300' : 'text-amber-300'
        }`}
      >
        {ctaLabel} <span aria-hidden>→</span>
      </p>
    </Link>
  );
}

