import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { OpposingCounsel } from '@/components/OpposingCounsel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mock Trial',
  description:
    'Argue your case out loud in a private mock trial. Advottic plays opposing counsel and the judge, asks the hard questions one at a time, and coaches you - so the real hearing is not the first time you hear them.',
};

/**
 * Mock Trial - "argue your case and have a trial of sorts."
 *
 * Standalone entry point for the practice cross-examination that also
 * lives inside a case. Pick which case you want to rehearse, and the
 * proven OpposingCounsel role-play (opposing counsel + judge + coach)
 * takes over. Reachable from the Action Center cockpit.
 */
export default async function MockTrialPage({
  searchParams,
}: {
  searchParams: { case?: string };
}) {
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) redirect('/sign-in?next=/action-center/mock-trial');
  }
  if (storageUnavailable()) {
    return (
      <div className="max-w-3xl mx-auto card p-8 text-sm text-ink-600">
        Connect storage to run a mock trial.
      </div>
    );
  }

  let cases: Awaited<ReturnType<typeof listCases>> = [];
  try {
    cases = await listCases();
  } catch {
    cases = [];
  }
  const open = cases.filter((c) => c.status !== 'closed' && c.status !== 'archived');
  const selectedId = searchParams.case;
  const selected = selectedId ? cases.find((c) => c.id === selectedId) ?? null : null;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <p className="text-sm mb-4">
        <Link
          href="/action-center"
          className="text-ink-500 hover:text-forest-900"
        >
          &larr; Action Center
        </Link>
      </p>

      {selected ? (
        <div className="space-y-5">
          <div>
            <p className="eyebrow mb-1">Mock trial</p>
            <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-forest-900" data-no-translate>
              {selected.title}
            </h1>
            <p className="text-sm text-ink-500 mt-1.5 max-w-xl leading-relaxed">
              Grounded in this case&rsquo;s real facts and exhibits. Answer
              each question the way you would in the room - out loud is best.
            </p>
          </div>
          <OpposingCounsel caseId={selected.id} />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <p className="eyebrow mb-1">Mock trial</p>
            <h1 className="font-display text-[32px] sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.06] text-forest-900">
              Argue your case - before it&rsquo;s the real thing
            </h1>
            <p className="text-sm text-ink-600 mt-2 max-w-xl leading-relaxed">
              A private mock trial. Advottic plays opposing counsel and the
              judge, asks the hard questions one at a time, then steps out to
              coach you. Pick the case you want to rehearse.
            </p>
          </div>

          {open.length === 0 ? (
            <div className="card p-8 text-center space-y-3">
              <p className="text-sm text-ink-600">
                You need an open case to rehearse first.
              </p>
              <Link href="/cases/new" className="btn-primary inline-flex">
                Start a case
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {open.map((c) => (
                <Link
                  key={c.id}
                  href={`/action-center/mock-trial?case=${c.id}`}
                  className="card-hover p-5 block"
                >
                  <h2 className="font-display text-[17px] font-medium text-ink-950 leading-tight" data-no-translate>
                    {c.title}
                  </h2>
                  <p className="text-xs text-ink-500 mt-1">
                    {c.caseType} · {c.posture}
                  </p>
                  <span className="mt-3 inline-flex items-center text-sm font-medium text-forest-900">
                    Rehearse this case
                    <span aria-hidden className="ml-1.5">
                      &rarr;
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink-400 leading-relaxed">
            Private practice and preparation - a role-play, not a real
            proceeding, and not legal advice.
          </p>
        </div>
      )}
    </main>
  );
}
