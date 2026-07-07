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
        <nav className="mb-4 text-sm">
          <Link
            href={`/cases/${params.id}`}
            className="text-forest-700 hover:text-forest-900 dark:text-cream-300"
          >
            ← Back to case
          </Link>
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
