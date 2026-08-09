import { notFound, redirect } from 'next/navigation';
import { ArchiveIcon } from '@/components/counsel/EntityIcons';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { getTimelineBundle } from '@/lib/timeline-actions';
import { aiConfigured } from '@/lib/timeline-ai';
import { resolveTimelineAccess, TIMELINE_PREVIEW_COOKIE } from '@/lib/timeline-entitlement';
import { TimelineBuilder } from './timeline-builder';
import { MinimalTimeline } from './minimal-timeline';
import { FactsPanel, type CaseFacts } from './facts-panel';
import { AdminPreviewToggle } from './admin-preview-toggle';

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
    .select('id, title, subject_name, subject_type, jurisdiction_country, jurisdiction_state, jurisdiction_city, case_type, description, posture, status, hearing_at, hearing_location, created_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!caseRow) notFound();

  const c = caseRow as {
    id: string; title: string; subject_name: string | null;
    subject_type: string | null; case_type: string | null;
    jurisdiction_country: string | null; jurisdiction_state: string | null; jurisdiction_city: string | null;
    description: string | null; posture: string | null; status: string | null;
    hearing_at: string | null; hearing_location: string | null; created_at: string | null;
  };
  // Jurisdiction is stored as three columns; compose a "City, State, Country" label.
  const jurisdiction =
    [c.jurisdiction_city, c.jurisdiction_state, c.jurisdiction_country].filter(Boolean).join(', ') || null;
  const facts: CaseFacts = {
    title: c.title,
    subjectName: c.subject_name,
    subjectType: c.subject_type,
    jurisdiction,
    caseType: c.case_type,
    posture: c.posture,
    status: c.status,
    description: c.description,
    hearingAt: c.hearing_at,
    hearingLocation: c.hearing_location,
    createdAt: c.created_at,
  };
  const [bundle, access, profile] = await Promise.all([
    getTimelineBundle(params.id),
    resolveTimelineAccess(),
    getProfile().catch(() => null),
  ]);
  const previewMode = cookies().get(TIMELINE_PREVIEW_COOKIE)?.value;
  const currentPreview: 'firm' | 'consumer' | 'locked' =
    previewMode === 'consumer' ? 'consumer' : previewMode === 'locked' ? 'locked' : 'firm';

  return (
    <main className="min-h-[100dvh] bg-cream-50 dark:bg-forest-950">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
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
        {profile?.isAdmin && <AdminPreviewToggle current={currentPreview} />}
        {access !== 'locked' && <FactsPanel facts={facts} />}
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
            <div className="flex justify-center text-forest-900/40 dark:text-cream-50/40">
            <ArchiveIcon size={30} />
          </div>
            <h1 className="mt-2 font-display text-2xl font-semibold text-forest-900 dark:text-cream-50">
              Case Timeline
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-600 dark:text-cream-300/80">
              Gather a lifetime of evidence (photos, documents, receipts, messages) into one
              organised, dated record your legal team can act on.{' '}
              <span data-hide-on-ios>
                Available on{' '}
                <span className="font-medium text-forest-900 dark:text-cream-100">Personal Plus</span>{' '}
                (submit &amp; overview) and firm plans (full AI build).
              </span>
              <span data-show-in-app>Included with a subscription on your account.</span>
            </p>
            <Link
              href="/billing"
              data-hide-on-ios
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
