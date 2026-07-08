import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { getFirmTimelineBundle } from '@/lib/firm-timeline-actions';
import { getCaseParticipants, getSectionComments, getChatThread } from '@/lib/case-collab-actions';
import { GENERAL_THREAD_KEY } from '@/lib/case-collab-types';
import { resolveTimelineAccess } from '@/lib/timeline-entitlement';
import { aiConfigured } from '@/lib/timeline-ai';
import { FactsPanel, type CaseFacts } from '@/app/cases/[id]/timeline/facts-panel';
import { FirmTimeline } from './firm-timeline';
import { RequestSidebarFocus } from '@/components/counsel/SidebarFocus';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  try {
    const ctx = await getActiveFirmContext();
    if (!ctx) return { title: 'Timeline' };
    const supabase = createServerSupabase();
    const { data } = await supabase.from('cases').select('title, firm_id').eq('id', params.id).maybeSingle();
    if (!data || (data as { firm_id: string | null }).firm_id !== ctx.firm.id) {
      return { title: 'Timeline · Not found' };
    }
    return { title: `${(data as { title: string }).title} · Timeline`, robots: { index: false, follow: false } };
  } catch {
    return { title: 'Timeline' };
  }
}

/**
 * Firm-native Case Timeline route. Renders inside the counsel shell (firm
 * chrome, NO consumer consent gate) and reads through the firm admin path, so
 * any firm member can view/build a matter's timeline without being routed into
 * the consumer /cases/[id]/timeline surface.
 */
export default async function FirmTimelinePage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();

  const { data: caseRow } = await supabase
    .from('cases')
    .select(
      'id, title, subject_name, subject_type, jurisdiction_country, jurisdiction_state, jurisdiction_city, case_type, description, posture, status, hearing_at, hearing_location, created_at, firm_id',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (!caseRow) notFound();
  const c = caseRow as {
    id: string; title: string; subject_name: string | null; subject_type: string | null;
    jurisdiction_country: string | null; jurisdiction_state: string | null; jurisdiction_city: string | null;
    case_type: string | null; description: string | null; posture: string | null; status: string | null;
    hearing_at: string | null; hearing_location: string | null; created_at: string | null; firm_id: string | null;
  };
  if (c.firm_id !== ctx.firm.id) notFound();

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

  const [bundle, access, participants, commentBundle, generalChat, user] = await Promise.all([
    getFirmTimelineBundle(ctx.firm.id, params.id),
    resolveTimelineAccess(),
    getCaseParticipants(ctx.firm.id, params.id),
    getSectionComments(ctx.firm.id, params.id),
    getChatThread(ctx.firm.id, params.id, GENERAL_THREAD_KEY),
    getCurrentUser(),
  ]);
  const aiEnabled = aiConfigured() && access === 'firm';

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      {/* Focus mode: slide the counsel rail out on this route. */}
      <RequestSidebarFocus />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500 dark:text-cream-100/60">
        <Link href="/counsel/cases" className="hover:text-forest-900 dark:hover:text-cream-100"><T>Matters</T></Link>
        <span aria-hidden>/</span>
        <Link href={`/counsel/cases/${params.id}`} className="max-w-[16rem] truncate hover:text-forest-900 dark:hover:text-cream-100" data-no-translate>
          {c.title}
        </Link>
        <span aria-hidden>/</span>
        <span className="font-medium text-forest-900 dark:text-cream-100" aria-current="page"><T>Timeline</T></span>
      </nav>

      <div>
        <p className="eyebrow mb-1"><T>Counsel · timeline</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 break-words" data-no-translate>
          {c.title}
        </h1>
      </div>

      <FactsPanel facts={facts} />

      <FirmTimeline
        firmId={ctx.firm.id}
        caseId={params.id}
        initialBundle={bundle}
        aiEnabled={aiEnabled}
        collab={{
          currentUserId: user?.id ?? '',
          participants,
          comments: commentBundle.comments,
          authors: commentBundle.authors,
          generalChat,
        }}
      />
    </div>
  );
}
