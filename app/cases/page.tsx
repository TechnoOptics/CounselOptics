import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCases, getProfile } from '@/lib/storage';
import { STATUS_LABEL, SUBJECT_TYPE_LABEL, type Case, type CaseStatus } from '@/lib/types';
import { storageUnavailable, STORAGE_SETUP_MESSAGE } from '@/lib/setup-status';
import { isSupabaseConfigured, getCurrentUser } from '@/lib/supabase/server';
import { TourModal } from '@/components/TourModal';
import { BrandMark } from '@/components/BrandMark';
import { BiometricEnrollPrompt } from '@/components/BiometricEnrollPrompt';
import { PermissionsPrimer } from '@/components/PermissionsPrimer';
import { WatchSync } from '@/components/WatchSync';

export const dynamic = 'force-dynamic';

export default async function CasesPage({
  searchParams,
}: {
  searchParams?: { welcome?: string; filter?: string };
}) {
  if (storageUnavailable()) return <SetupNeeded />;

  // Consent is now handled by a layout-level popup modal; no redirect here.
  let profile = null;
  if (isSupabaseConfigured()) {
    profile = await getProfile().catch(() => null);
  }

  let cases;
  try {
    cases = await listCases();
  } catch (err) {
    return <SetupNeeded message={err instanceof Error ? err.message : undefined} />;
  }
  const showWelcomeBack = searchParams?.welcome === '1';
  // Tour fires for any consented user who hasn't completed or skipped it yet,
  // not only on the post-consent redirect. The old gate (welcome=1) meant a
  // user who refreshed mid-flow, opened /cases from a bookmark, or closed
  // the tab and came back never saw the walkthrough at all - their first
  // real impression was an empty dashboard with no orientation. Once they
  // hit "Got it" or "Skip tour", markTourCompletedAction sets the flag and
  // it never appears again, so this stays a one-time event.
  const showTour = Boolean(profile?.consentedAt && !profile?.tourCompletedAt);
  const filter = searchParams?.filter === 'shared' ? 'shared' : 'all';

  const currentUser = isSupabaseConfigured() ? await getCurrentUser() : null;
  const myId = currentUser?.id ?? null;
  const isClosed = (s: Case['status']) => s === 'closed' || s === 'archived';
  const ownedAll = myId ? cases.filter((c) => c.ownerId === myId) : cases;
  const owned = ownedAll.filter((c) => !isClosed(c.status));
  const closed = ownedAll.filter((c) => isClosed(c.status));
  const sharedWithMe = myId ? cases.filter((c) => c.ownerId !== myId) : [];

  // Shared-only view: render just the "Shared with me" section.
  if (filter === 'shared') {
    return (
      <div className="space-y-8 animate-fade-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Collaboration</p>
            <h1 className="text-3xl font-semibold tracking-tight text-forest-900">
              Shared with me
            </h1>
            <p className="text-sm text-ink-500 mt-1">
              {sharedWithMe.length === 0
                ? 'No cases have been shared with you yet.'
                : `${sharedWithMe.length} case${sharedWithMe.length === 1 ? '' : 's'} shared with you`}
            </p>
          </div>
          <Link href="/cases" className="btn-secondary">
            All cases
          </Link>
        </div>

        {sharedWithMe.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink-600 leading-relaxed max-w-xl mx-auto">
            When someone invites you as a collaborator on their case, it will appear here. Ask
            the case owner for an invite at your account email.
          </div>
        ) : (
          <CaseGrid cases={sharedWithMe} sharedHint />
        )}
      </div>
    );
  }

  // Wear OS glance summary: open-case count + the most recently
  // updated open case. Computed from data already loaded above (no
  // extra query / API). WatchSync forwards it to the watch only on
  // the Android Capacitor shell; it's an inert no-op elsewhere.
  const latestOpen = [...owned].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0];

  return (
    <div className="space-y-8 animate-fade-up">
      <WatchSync
        openCount={owned.length}
        latestTitle={latestOpen?.title ?? ''}
        latestCaseId={latestOpen?.id ?? ''}
      />
      <TourModal visible={Boolean(showTour)} />
      {/* Biometric enrollment prompt - first time on a native shell only.
          No-op on web, on devices without biometric, and after dismissal. */}
      <BiometricEnrollPrompt />
      {/* One-time permissions priming (Microphone + Notifications) -
          native first launch only. No-op on web and after first run.
          Camera/Location intentionally excluded until those features
          ship (no plugin = App Store rejection). */}
      <PermissionsPrimer />
      {showWelcomeBack && (
        <div className="rounded-lg border border-gold-200 bg-cream-50 px-4 py-3 text-sm text-forest-900 animate-fade-in">
          <strong>Thanks for joining Advottic{profile?.displayName ? `, ${firstName(profile.displayName)}` : ''}!</strong>{' '}
          We've put together a quick tour of the key features. When you're ready, click{' '}
          <strong>New case</strong> to start your first matter, or use the avatar menu to set up billing.
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Dashboard</p>
          <h1 className="font-display text-4xl font-medium tracking-[-0.015em] leading-[1.05] text-forest-900">Cases</h1>
          <p className="text-sm text-ink-500 mt-1">
            {cases.length === 0
              ? 'No cases yet. Create your first case file to get started.'
              : `${owned.length} active${closed.length ? ` · ${closed.length} closed` : ''}${sharedWithMe.length ? ` · ${sharedWithMe.length} shared with you` : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/deadlines" className="btn-secondary">
            Deadline Radar
          </Link>
          <Link href="/decoder" className="btn-secondary">
            Decode a document
          </Link>
          <Link
            href="/safe"
            className="btn border border-rose-300 text-rose-700 hover:bg-rose-50 font-semibold"
          >
            Safe Witness
          </Link>
          <Link href="/cases/new/speak" className="btn-secondary">
            Speak your case
          </Link>
          <Link href="/cases/new" className="btn-primary">
            <PlusIcon />
            New case
          </Link>
        </div>
      </div>

      {/* KPI tiles - mockup-inspired dark cards with bright accent numbers */}
      {cases.length > 0 && <KpiRow owned={owned} closed={closed} sharedWithMe={sharedWithMe} />}

      {/* Your cases */}
      <section id="your-cases" className="space-y-3 scroll-mt-28">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700">
          Your cases
        </h2>
        {owned.length === 0 ? (
          <EmptyCasesCard />
        ) : (
          <CaseGrid cases={owned} />
        )}
      </section>

      {/* Shared with me */}
      {sharedWithMe.length > 0 && (
        <section id="shared-cases" className="space-y-3 scroll-mt-28">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700">
              Shared with me
            </h2>
            <Link
              href="/cases?filter=shared"
              className="text-xs text-ink-500 hover:text-forest-900 underline"
            >
              View all
            </Link>
          </div>
          <CaseGrid cases={sharedWithMe} sharedHint />
        </section>
      )}

      {/* Closed cases */}
      {closed.length > 0 && (
        <section className="space-y-3">
          <details className="group">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-3 select-none">
              <h2 className="text-sm font-semibold tracking-wider uppercase text-ink-500 group-hover:text-forest-700 transition-colors">
                Closed cases
                <span className="ml-2 badge bg-ink-100 text-ink-600 normal-case tracking-normal font-normal">
                  {closed.length}
                </span>
              </h2>
              <span className="text-xs text-ink-400 group-hover:text-ink-700 transition-colors">
                <span className="hidden group-open:inline">Hide</span>
                <span className="group-open:hidden">Show</span>
              </span>
            </summary>
            <div className="mt-4 opacity-90">
              <CaseGrid cases={closed} closedHint />
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

function KpiRow({
  owned,
  closed,
  sharedWithMe,
}: {
  owned: Case[];
  closed: Case[];
  sharedWithMe: Case[];
}) {
  // Build a sorted list of upcoming hearings tagged with their case id so
  // the "Next hearing" tile can deep-link straight to that case's hearing tab.
  const upcoming = [...owned, ...sharedWithMe]
    .filter((c): c is Case & { hearingAt: string } => Boolean(c.hearingAt))
    .map((c) => ({ id: c.id, t: Date.parse(c.hearingAt as string) }))
    .filter((x) => !Number.isNaN(x.t) && x.t >= Date.now())
    .sort((a, b) => a.t - b.t);
  const next = upcoming[0] ?? null;
  const nextLabel = next ? hearingRelative(next.t) : 'None scheduled';
  const nextSub = next
    ? new Date(next.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'add one in a case';

  // Count critical-soon hearings (<= 7 days)
  const soon = upcoming.filter((x) => (x.t - Date.now()) / 86_400_000 <= 7).length;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger">
      <KpiTile
        label="Active cases"
        value={owned.length}
        sub={closed.length ? `${closed.length} closed in archive` : 'all open'}
        accent="emerald"
        href={owned.length > 0 ? '/cases#your-cases' : undefined}
      />
      <KpiTile
        label="Next hearing"
        value={nextLabel}
        sub={nextSub}
        accent={soon > 0 ? 'amber' : 'emerald'}
        small
        href={next ? `/cases/${next.id}#hearing` : undefined}
      />
      <KpiTile
        label="Hearings within 7 days"
        value={soon}
        sub={soon === 0 ? 'nothing imminent' : 'see Hearing tab on each case'}
        accent={soon > 0 ? 'rose' : 'emerald'}
        href={soon > 0 ? '/cases#your-cases' : undefined}
      />
      <KpiTile
        label="Shared with me"
        value={sharedWithMe.length}
        sub={sharedWithMe.length === 0 ? 'no shared cases' : 'attorney / collaborators'}
        accent="cream"
        href={sharedWithMe.length > 0 ? '/cases?filter=shared' : undefined}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent,
  small = false,
  href,
}: {
  label: string;
  value: string | number;
  sub: string;
  accent: 'emerald' | 'amber' | 'rose' | 'cream';
  small?: boolean;
  href?: string;
}) {
  const accentClass =
    accent === 'emerald'
      ? 'text-emerald-300'
      : accent === 'amber'
        ? 'text-amber-300'
        : accent === 'rose'
          ? 'text-rose-300'
          : 'text-cream-200';

  const body = (
    <>
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-cream-100/65 flex items-center justify-between">
        <span>{label}</span>
        {href && (
          <span aria-hidden className="text-cream-100/45 group-hover:text-gold-300 transition-colors">
            <ArrowUpRightIcon />
          </span>
        )}
      </p>
      <p
        className={`mt-3 font-semibold tracking-tight tabular-nums ${
          small ? 'text-2xl md:text-[26px]' : 'text-4xl'
        } ${accentClass}`}
      >
        {value}
      </p>
      <p className="text-xs text-cream-100/60 mt-1.5">{sub}</p>
      {/* subtle gold accent bar */}
      <span className="absolute left-5 right-5 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-400/40 to-transparent" />
    </>
  );

  const baseClass =
    'group relative overflow-hidden rounded-2xl bg-gradient-to-br from-forest-800 via-forest-900 to-forest-950 text-cream-100 p-5 ring-1 ring-forest-700/40 shadow-card transition-all duration-200';

  if (href) {
    return (
      <Link
        href={href}
        className={`${baseClass} hover:-translate-y-0.5 hover:ring-gold-400/40 hover:shadow-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60`}
      >
        {body}
      </Link>
    );
  }
  return <div className={baseClass}>{body}</div>;
}

function ArrowUpRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 17L17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function hearingRelative(t: number): string {
  const diffMs = t - Date.now();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
    return `In ${hours}h`;
  }
  if (days === 1) return 'Tomorrow';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

function EmptyCasesCard() {
  return (
    <div className="card relative overflow-hidden p-10 text-center">
      <div
        aria-hidden
        className="absolute -right-6 -bottom-8 text-gold-500/10 pointer-events-none select-none animate-float"
      >
        <BrandMark size={220} />
      </div>
      <div className="relative">
        <p className="eyebrow justify-center mb-3">Empty file room</p>
        <p className="text-ink-600 mb-5 max-w-md mx-auto">
          No cases of your own yet. Start one and we&apos;ll structure the rest as you go.
        </p>
        <Link href="/cases/new" className="btn-primary animate-glow">
          Create your first case
        </Link>
      </div>
    </div>
  );
}

function CaseGrid({
  cases,
  sharedHint = false,
  closedHint = false,
}: {
  cases: Case[];
  sharedHint?: boolean;
  closedHint?: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 stagger">
      {cases.map((c) => {
        const loc = [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
          .filter(Boolean)
          .join(', ');
        return (
          <Link
            key={c.id}
            href={`/cases/${c.id}`}
            className={`card-hover p-5 block ${closedHint ? 'opacity-80 hover:opacity-100' : ''}`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 className="font-display text-[19px] font-medium text-ink-950 leading-tight tracking-[-0.005em]">
                {c.title}
              </h2>
              <div className="flex flex-col items-end gap-1">
                <StatusPill status={c.status} />
                {sharedHint && (
                  <span className="badge bg-cream-50 text-forest-900 border border-gold-300 text-[10px]">
                    Shared
                  </span>
                )}
                {closedHint && (
                  <span className="badge bg-ink-100 text-ink-600 text-[10px]">Closed</span>
                )}
              </div>
            </div>
            <p className="text-sm text-ink-700 mb-4">
              <span className="text-ink-500">{SUBJECT_TYPE_LABEL[c.subjectType]}: </span>
              {c.subjectName}
            </p>
            <div className="text-xs text-ink-500 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="inline-flex items-center">{c.caseType}</span>
              {loc && (
                <>
                  <Dot />
                  <span>{loc}</span>
                </>
              )}
              <Dot />
              <span>Updated {new Date(c.updatedAt).toLocaleDateString()}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-ink-300" />;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const STATUS_STYLES: Record<CaseStatus, string> = {
  draft: 'bg-ink-100 text-ink-700',
  open: 'bg-sky-50 text-sky-800 border border-sky-200',
  under_review: 'bg-amber-50 text-amber-900 border border-amber-200',
  needs_evidence: 'bg-rose-50 text-rose-800 border border-rose-200',
  export_ready: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  closed: 'bg-ink-100 text-ink-600',
  archived: 'bg-ink-100 text-ink-500',
};

function StatusPill({ status }: { status: CaseStatus }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{STATUS_LABEL[status]}</span>;
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed || trimmed.includes('@')) return trimmed.split('@')[0];
  return trimmed.split(/\s+/)[0];
}

function SetupNeeded({ message }: { message?: string } = {}) {
  return (
    <div className="max-w-2xl mx-auto card p-8 space-y-3">
      <p className="eyebrow">Setup required</p>
      <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
        Connect Supabase to start using cases
      </h1>
      <p className="text-sm text-ink-600 leading-relaxed">
        {STORAGE_SETUP_MESSAGE}
      </p>
      {message && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          Storage error: {message}
        </p>
      )}
      <ol className="text-sm text-ink-700 space-y-2 list-decimal list-inside">
        <li>Create a Supabase project (free tier) at supabase.com.</li>
        <li>
          In Supabase SQL Editor, run the contents of <code className="font-mono">supabase/schema.sql</code> from the repo.
        </li>
        <li>
          Add three environment variables in your Vercel project (Settings → Environment Variables):{' '}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{' '}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> (server-side only).
        </li>
        <li>Redeploy.</li>
      </ol>
      <p className="text-xs text-ink-500">
        Detailed steps in <code className="font-mono">SETUP.md</code> in the repository.
      </p>
    </div>
  );
}
