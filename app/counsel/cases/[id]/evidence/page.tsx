import Link from 'next/link';
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

export const dynamic = 'force-dynamic';
// A heavy matter (hundreds of evidence rows) can push the assemble past the
// default ~10s function budget; raise the ceiling so it never 504s, matching
// the matter page.
export const maxDuration = 60;

export function generateMetadata() {
  return { title: 'Evidence intake · Counsel' };
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

  const supabase = createServerSupabase();
  // A guest is not a firm member, so RLS returns nothing on the user client -
  // read the matter row through the admin client (already authorized above).
  const admin = isGuest ? createAdminSupabase() : null;
  // One parallel wave: the case row (for the header + ownership guard), the
  // timeline, and the access tier.
  const [caseRes, timeline, access] = await Promise.all([
    isGuest
      ? (admin
          ? admin.from('cases').select('id, title, firm_id').eq('id', params.id).maybeSingle()
          : Promise.resolve({ data: null }))
      : supabase.from('cases').select('id, title, firm_id').eq('id', params.id).maybeSingle(),
    getFirmCaseTimelinePage(firmId, params.id, { limit: 120 }),
    resolveTimelineAccess(),
  ]);
  const c = caseRes.data as { id: string; title: string; firm_id: string | null } | null;
  if (!c || c.firm_id !== firmId) notFound();
  const aiEnabled = aiConfigured() && access === 'firm' && !isGuest;

  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <Link
          href={`/counsel/cases/${params.id}`}
          className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline"
        >
          ← <T>Back to matter</T>
        </Link>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
          <T>Evidence intake</T>
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 break-words" data-no-translate>
          {c.title}
        </p>
      </header>

      {aiEnabled && <BulkReanalyze firmId={firmId} caseId={params.id} />}

      <EvidenceIntake
        firmId={firmId}
        caseId={params.id}
        initialEvents={timeline.events ?? []}
        initialCursor={timeline.nextCursor ?? null}
        aiEnabled={aiEnabled}
      />

      {!isGuest && access === 'firm' && <RecurringPeople firmId={firmId} caseId={params.id} />}
    </div>
  );
}
