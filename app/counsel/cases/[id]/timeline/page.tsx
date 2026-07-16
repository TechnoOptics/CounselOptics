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
import { type CaseFacts } from '@/app/cases/[id]/timeline/facts-panel';
import { FirmFactsPanel } from './firm-facts-panel';
import { type EditMatterInitial } from '../edit-matter-form';
import { FirmTimeline } from './firm-timeline';
import { RequestSidebarFocus } from '@/components/counsel/SidebarFocus';
import { CaseMenu } from '@/components/counsel/CaseMenu';
import { listFirmApproaches } from '@/lib/firm-approach-actions';
import { T } from '@/components/i18n/LocaleProvider';
import { getGuestCaseSummary } from '@/lib/counsel-guest';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { logCaseActivity } from '@/lib/case-activity-log';

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
  let firmId: string;
  let isGuest = false;
  if (ctx) {
    firmId = ctx.firm.id;
  } else {
    // Case-scoped co-counsel GUEST: render the SAME firm timeline BUILDER for
    // their assigned matter, so co-counsel can edit the timeline. Collaboration
    // (chat/comments) and AI stay firm-only; the timeline write actions are
    // widened to this scoped guest server-side.
    const summary = await getGuestCaseSummary(params.id);
    if (!summary || !summary.guest.firmId) redirect('/counsel');
    firmId = summary.guest.firmId;
    isGuest = true;
  }
  const supabase = createServerSupabase();
  const CASE_COLS =
    'id, title, subject_name, subject_type, subject_profile, jurisdiction_country, jurisdiction_state, jurisdiction_city, case_type, description, posture, status, hearing_at, hearing_location, hearing_notes, created_at, firm_id';
  // A guest is not a firm member, so RLS returns nothing on the user client -
  // read the matter through the admin client (already authorized: the guest
  // grant was confirmed above). A firm member keeps the RLS-scoped read.
  const admin = isGuest ? createAdminSupabase() : null;
  const { data: caseRow } = isGuest
    ? (admin
        ? await admin.from('cases').select(CASE_COLS).eq('id', params.id).maybeSingle()
        : { data: null })
    : await supabase.from('cases').select(CASE_COLS).eq('id', params.id).maybeSingle();
  if (!caseRow) notFound();
  const c = caseRow as {
    id: string; title: string; subject_name: string | null; subject_type: string | null;
    subject_profile: Record<string, string> | null;
    jurisdiction_country: string | null; jurisdiction_state: string | null; jurisdiction_city: string | null;
    case_type: string | null; description: string | null; posture: string | null; status: string | null;
    hearing_at: string | null; hearing_location: string | null; hearing_notes: string | null;
    created_at: string | null; firm_id: string | null;
  };
  if (c.firm_id !== firmId) notFound();

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

  // Pre-fill for inline editing (mirrors the matter page's Edit details form).
  // hearing_at is stored as an ISO instant; a datetime-local input wants
  // "YYYY-MM-DDTHH:mm", so trim the ISO string rather than reformatting.
  const editInitial: EditMatterInitial = {
    title: c.title,
    subject: c.subject_name ?? '',
    subjectType: (c.subject_type as EditMatterInitial['subjectType']) ?? 'person',
    caseType: c.case_type ?? '',
    posture: c.posture === 'defendant' ? 'defendant' : 'claimant',
    country: c.jurisdiction_country ?? '',
    state: c.jurisdiction_state ?? '',
    city: c.jurisdiction_city ?? '',
    description: c.description ?? '',
    profile: c.subject_profile ?? {},
    hearingAt: c.hearing_at ? c.hearing_at.slice(0, 16) : '',
    hearingLocation: c.hearing_location ?? '',
    hearingNotes: c.hearing_notes ?? '',
  };

  const [bundle, access, participants, commentBundle, generalChat, user, approachesRes] = await Promise.all([
    getFirmTimelineBundle(firmId, params.id),
    resolveTimelineAccess(),
    isGuest ? Promise.resolve([]) : getCaseParticipants(firmId, params.id),
    isGuest
      ? Promise.resolve({ comments: [], authors: [] })
      : getSectionComments(firmId, params.id),
    isGuest ? Promise.resolve([]) : getChatThread(firmId, params.id, GENERAL_THREAD_KEY),
    getCurrentUser(),
    // Approach titles for the case menu's Export dropdown (firm members only).
    isGuest
      ? Promise.resolve({ ok: false as const })
      : listFirmApproaches(firmId, params.id).catch(() => ({ ok: false as const })),
  ]);
  const approaches =
    'approaches' in approachesRes ? (approachesRes.approaches ?? []) : [];
  // AI (bulk re-analyze, suggestions) and collaboration stay firm-only; a guest
  // co-counsel still gets the full manual timeline builder.
  const aiEnabled = aiConfigured() && access === 'firm' && !isGuest;

  // Record a guest's timeline visit for the firm's activity stream (skipFirm so
  // a firm member's own visit isn't logged).
  void logCaseActivity({ caseId: params.id, action: 'view_timeline', skipFirm: true, throttleMinutes: 15 });

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      {/* Focus mode: slide the counsel rail out on this route. */}
      <RequestSidebarFocus />
      {!isGuest && (
        <CaseMenu
          caseId={params.id}
          active="timeline"
          approaches={approaches.map((a) => ({ id: a.id, title: a.title }))}
        />
      )}
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

      <FirmFactsPanel facts={facts} firmId={firmId} caseId={params.id} editInitial={editInitial} canEdit={!isGuest} />

      <FirmTimeline
        firmId={firmId}
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
