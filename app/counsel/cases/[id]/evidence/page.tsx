import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { aiConfigured } from '@/lib/timeline-ai';
import { resolveTimelineAccess } from '@/lib/timeline-entitlement';
import { getFirmCaseTimelinePage } from '@/lib/case-evidence-actions';
import { T } from '@/components/i18n/LocaleProvider';
import { EvidenceIntake } from './evidence-intake';
import { RecurringPeople } from './recurring-people';
import { BulkReanalyze } from './bulk-reanalyze';
import { getGuestCaseSummary } from '@/lib/counsel-guest';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { logCaseActivity } from '@/lib/case-activity-log';
import { getCurrentUser } from '@/lib/supabase/server';
import { readEvidenceFolderRegistry } from '@/lib/evidence-folders';
import { CaseMenu } from '@/components/counsel/CaseMenu';
import { PageHeader } from '@/components/counsel/ui';
import { listFirmApproaches } from '@/lib/firm-approach-actions';
import { caseFileIsOpen } from '@/lib/case-file';

export const dynamic = 'force-dynamic';
// A heavy matter (hundreds of evidence rows) can push the assemble past the
// default ~10s function budget; raise the ceiling so it never 504s, matching
// the matter page.
export const maxDuration = 60;

export function generateMetadata() {
  return { title: 'Evidence Center · Counsel' };
}

export default async function CaseEvidencePage({
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
    // Case-scoped co-counsel GUEST: render the SAME firm evidence intake for
    // their assigned matter, so co-counsel can edit the evidence. AI (bulk
    // re-analyze, face grouping) stays firm-only; the write actions are widened
    // to this scoped guest server-side.
    const summary = await getGuestCaseSummary(params.id);
    if (!summary || !summary.guest.firmId) redirect('/counsel');
    firmId = summary.guest.firmId;
    isGuest = true;
  }

  // The Evidence Center is a court surface: exhibit numbers, folders, packet
  // selection. A matter the firm is handling as a request does not have it.
  // Back to the matter, not notFound() - the matter is real and readable, this
  // one surface is not open on it. Every uploaded item and its file stay
  // exactly where they are and come back with the case file.
  if (!(await caseFileIsOpen(params.id))) redirect(`/counsel/cases/${params.id}`);

  const supabase = createServerSupabase();
  // A guest is not a firm member, so RLS returns nothing on the user client -
  // read the matter row through the admin client (already authorized above).
  const admin = isGuest ? createAdminSupabase() : null;
  // One parallel wave: the case row (for the header + ownership guard), the
  // timeline, and the access tier.
  const [caseRes, timeline, access, approachesRes] = await Promise.all([
    isGuest
      ? (admin
          ? admin.from('cases').select('id, title, firm_id').eq('id', params.id).maybeSingle()
          : Promise.resolve({ data: null }))
      : supabase.from('cases').select('id, title, firm_id').eq('id', params.id).maybeSingle(),
    getFirmCaseTimelinePage(firmId, params.id, { limit: 120 }),
    resolveTimelineAccess(),
    // Approach titles for the case menu's Export dropdown (firm members only).
    isGuest
      ? Promise.resolve({ ok: false as const })
      : listFirmApproaches(firmId, params.id).catch(() => ({ ok: false as const })),
  ]);
  const approaches =
    'approaches' in approachesRes ? (approachesRes.approaches ?? []) : [];
  const c = caseRes.data as { id: string; title: string; firm_id: string | null } | null;
  if (!c || c.firm_id !== firmId) notFound();

  // Folder visibility registry + who is looking, so the client can hide
  // another user's private folders (and show the toggle on your own).
  const viewer = await getCurrentUser();
  const registryAdmin = admin ?? createAdminSupabase();
  const folderRegistry = registryAdmin
    ? await readEvidenceFolderRegistry(registryAdmin, params.id)
    : {};
  const aiEnabled = aiConfigured() && access === 'firm' && !isGuest;

  // Record a guest's evidence-files visit (skipFirm so firm-member visits are
  // not logged into the activity stream).
  void logCaseActivity({ caseId: params.id, action: 'view_evidence', skipFirm: true, throttleMinutes: 15 });

  return (
    <div className="space-y-5">
      {!isGuest && (
        <CaseMenu
          caseId={params.id}
          active="evidence"
          approaches={approaches.map((a) => ({ id: a.id, title: a.title }))}
        />
      )}
      {/* Both shells carry persistent matter navigation above (firm CaseMenu /
          guest tabs), so no extra Back link - the header goes straight to the
          page identity. */}
      <PageHeader
        className="min-w-0"
        title={<T>Evidence Center</T>}
        subtitle={<span data-no-translate>{c.title}</span>}
      />

      {aiEnabled && <BulkReanalyze firmId={firmId} caseId={params.id} />}

      <EvidenceIntake
        firmId={firmId}
        caseId={params.id}
        initialEvents={timeline.events ?? []}
        initialCursor={timeline.nextCursor ?? null}
        aiEnabled={aiEnabled}
        viewerId={viewer?.id ?? null}
        initialFolderMeta={folderRegistry}
      />

      {!isGuest && access === 'firm' && <RecurringPeople firmId={firmId} caseId={params.id} />}
    </div>
  );
}
