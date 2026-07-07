import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { getTimelineBundle } from '@/lib/timeline-actions';
import { aiConfigured } from '@/lib/timeline-ai';
import { resolveTimelineAccess } from '@/lib/timeline-entitlement';
import { TimelineBuilder } from './timeline-builder';
import { MinimalTimeline } from './minimal-timeline';

export const metadata = {
  title: 'Case Timeline · Advottic',
};

export default async function TimelinePage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=/cases/${params.id}/timeline`);

  // RLS: a non-member gets no row.
  const supabase = createServerSupabase();
  const { data: caseRow } = await supabase
    .from('cases')
    .select('id, title, subject_name')
    .eq('id', params.id)
    .maybeSingle();
  if (!caseRow) notFound();

  const c = caseRow as { id: string; title: string; subject_name: string | null };
  const [bundle, access] = await Promise.all([
    getTimelineBundle(params.id),
    resolveTimelineAccess(),
  ]);

  return (
    <main className="min-h-[100dvh] bg-cream-50 dark:bg-forest-950">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-ink-500 dark:text-cream-300/70">
          <Link href="/cases" className="hover:text-forest-900 dark:hover:text-cream-100">Cases</Link>
          <span aria-hidden>/</span>
          <Link
            href={`/cases/${params.id}`}
            className="max-w-[16rem] truncate hover:text-forest-900 dark:hover:text-cream-100"
            data-no-translate
          >
            {c.title}
          </Link>
          <span aria-hidden>/</span>
          <span className="font-medium text-forest-900 dark:text-cream-100" aria-current="page">Timeline</span>
        </nav>
        {access === 'firm' ? (
          <TimelineBuilder
            caseId={params.id}
            caseTitle={c.title}
            subjectName={c.subject_name}
            initialBundle={bundle}
            aiEnabled={aiConfigured()}
          />
        ) : access === 'submit' ? (
          <MinimalTimeline
            caseId={params.id}
            caseTitle={c.title}
            initialBundle={bundle}
          />
        ) : (
          <div className="rounded-2xl border border-forest-900/10 bg-white p-10 text-center dark:border-cream-50/10 dark:bg-forest-900/40">
            <div className="text-3xl">🗂️</div>
            <h1 className="mt-2 font-display text-2xl font-semibold text-forest-900 dark:text-cream-50">
              Case Timeline
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-600 dark:text-cream-300/80">
              Gather a lifetime of evidence — photos, documents, receipts, messages — into one
              organised, dated record your legal team can act on. Available on{' '}
              <span className="font-medium text-forest-900 dark:text-cream-100">Personal Plus</span>{' '}
              (submit &amp; overview) and firm plans (full AI build).
            </p>
            <Link
              href="/billing"
              className="mt-5 inline-block rounded-lg bg-forest-900 px-5 py-2.5 text-sm font-semibold text-cream-50 dark:bg-gold-metal dark:text-forest-950"
            >
              See plans
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
