import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { getTimelineBundle } from '@/lib/timeline-actions';
import { aiConfigured } from '@/lib/timeline-ai';
import { TimelineBuilder } from './timeline-builder';

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
  const bundle = await getTimelineBundle(params.id);

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
        <TimelineBuilder
          caseId={params.id}
          caseTitle={c.title}
          subjectName={c.subject_name}
          initialBundle={bundle}
          aiEnabled={aiConfigured()}
        />
      </div>
    </main>
  );
}
