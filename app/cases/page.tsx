import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCases, getProfile } from '@/lib/storage';
import { STATUS_LABEL, SUBJECT_TYPE_LABEL, type Case, type CaseStatus } from '@/lib/types';
import { storageUnavailable, STORAGE_SETUP_MESSAGE } from '@/lib/setup-status';
import { isSupabaseConfigured, getCurrentUser } from '@/lib/supabase/server';
import { TourModal } from '@/components/TourModal';

export const dynamic = 'force-dynamic';

export default async function CasesPage({
  searchParams,
}: {
  searchParams?: { welcome?: string };
}) {
  if (storageUnavailable()) return <SetupNeeded />;

  let profile = null;
  if (isSupabaseConfigured()) {
    profile = await getProfile().catch(() => null);
    // Consent gate: unconsented users get sent to /welcome before they see anything.
    if (profile && !profile.consentedAt) {
      redirect('/welcome');
    }
  }

  let cases;
  try {
    cases = await listCases();
  } catch (err) {
    return <SetupNeeded message={err instanceof Error ? err.message : undefined} />;
  }
  const showWelcomeBack = searchParams?.welcome === '1';
  const showTour = showWelcomeBack && profile?.consentedAt && !profile?.tourCompletedAt;

  const currentUser = isSupabaseConfigured() ? await getCurrentUser() : null;
  const myId = currentUser?.id ?? null;
  const owned = myId ? cases.filter((c) => c.ownerId === myId) : cases;
  const sharedWithMe = myId ? cases.filter((c) => c.ownerId !== myId) : [];

  return (
    <div className="space-y-8">
      <TourModal visible={Boolean(showTour)} />
      {showWelcomeBack && (
        <div className="rounded-lg border border-gold-200 bg-cream-50 px-4 py-3 text-sm text-forest-900">
          <strong>Welcome to Advottic</strong>
          {profile?.displayName ? `, ${firstName(profile.displayName)}` : ''}. Click <strong>New case</strong> to start your first matter, or use the avatar menu to set up billing.
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Your files</p>
          <h1 className="text-3xl font-semibold tracking-tight text-forest-900">Cases</h1>
          <p className="text-sm text-ink-500 mt-1">
            {cases.length === 0
              ? 'No cases yet. Create your first case file to get started.'
              : `${owned.length} owned${sharedWithMe.length ? ` · ${sharedWithMe.length} shared with you` : ''}`}
          </p>
        </div>
        <Link href="/cases/new" className="btn-primary">
          <PlusIcon />
          New case
        </Link>
      </div>

      {/* Your cases */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700">
          Your cases
        </h2>
        {owned.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-ink-600 mb-4">No cases of your own yet. Start by creating one.</p>
            <Link href="/cases/new" className="btn-primary">
              Create case
            </Link>
          </div>
        ) : (
          <CaseGrid cases={owned} />
        )}
      </section>

      {/* Shared with me */}
      {sharedWithMe.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700">
            Shared with me
          </h2>
          <CaseGrid cases={sharedWithMe} sharedHint />
        </section>
      )}
    </div>
  );
}

function CaseGrid({ cases, sharedHint = false }: { cases: Case[]; sharedHint?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cases.map((c) => {
        const loc = [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
          .filter(Boolean)
          .join(', ');
        return (
          <Link key={c.id} href={`/cases/${c.id}`} className="card-hover p-5 block">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 className="font-semibold text-ink-950 leading-tight tracking-tight">
                {c.title}
              </h2>
              <div className="flex flex-col items-end gap-1">
                <StatusPill status={c.status} />
                {sharedHint && (
                  <span className="badge bg-cream-50 text-forest-900 border border-gold-300 text-[10px]">
                    Shared
                  </span>
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
