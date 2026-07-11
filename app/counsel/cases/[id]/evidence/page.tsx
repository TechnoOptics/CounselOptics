import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { aiConfigured } from '@/lib/timeline-ai';
import { resolveTimelineAccess } from '@/lib/timeline-entitlement';
import { getFirmCaseTimeline } from '@/lib/case-evidence-actions';
import { T } from '@/components/i18n/LocaleProvider';
import { EvidenceIntake } from './evidence-intake';
import { RecurringPeople } from './recurring-people';
import { BulkReanalyze } from './bulk-reanalyze';
import { getGuestTimelineBundle, getGuestCaseSummary } from '@/lib/counsel-guest';
import { GuestEvidenceView } from './guest-evidence-view';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Evidence intake · Counsel' };
}

export default async function CaseEvidencePage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) {
    // Case-scoped co-counsel GUEST: read-only evidence view if they have access.
    const summary = await getGuestCaseSummary(params.id);
    if (summary) {
      const bundle = await getGuestTimelineBundle(params.id);
      return (
        <GuestEvidenceView
          caseId={params.id}
          caseTitle={summary.case.title}
          bundle={bundle}
        />
      );
    }
    redirect('/counsel');
  }

  const supabase = createServerSupabase();
  const { data: caseRow } = await supabase
    .from('cases')
    .select('id, title, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  const c = caseRow as { id: string; title: string; firm_id: string | null } | null;
  if (!c || c.firm_id !== ctx.firm.id) notFound();

  const [timeline, access] = await Promise.all([
    getFirmCaseTimeline(ctx.firm.id, params.id),
    resolveTimelineAccess(),
  ]);
  const aiEnabled = aiConfigured() && access === 'firm';

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

      {aiEnabled && <BulkReanalyze firmId={ctx.firm.id} caseId={params.id} />}

      <EvidenceIntake
        firmId={ctx.firm.id}
        caseId={params.id}
        initialEvents={timeline.events ?? []}
        aiEnabled={aiEnabled}
      />

      {access === 'firm' && <RecurringPeople firmId={ctx.firm.id} caseId={params.id} />}
    </div>
  );
}
