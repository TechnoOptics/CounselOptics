import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { readRequestFolders } from '@/lib/request-folders';
import { IntakeInbox, type InboxIntake } from '@/components/counsel/IntakeInbox';
import { Tabs, type TabDef } from '@/components/Tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request inbox · Counsel' };

/**
 * Triage queue for everything landing on the legal team. Split into
 * two tabs by who sent it:
 *
 *   - Internal: requests filed by an employee from the Hub
 *     (firm_matter_intakes.intake_answers.submitted_by is set).
 *   - External: outside-client matters and anything not employee-
 *     filed - intake from clients, vendors, opposing parties, etc.
 *
 * Each tab uses the same lanes (Needs attention / In review /
 * Accepted / Closed) so daily triage feels identical regardless of
 * source. Creating a new intake lives on /counsel/intake.
 */
export default async function CounselInboxPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();
  const { data: rows } = await supabase
    .from('firm_matter_intakes')
    .select(
      'id, client_name, matter_type, jurisdiction_state, status, created_at, intake_answers',
    )
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: false })
    .limit(200);
  const intakes = (rows ?? []) as InboxIntake[];
  const folders = readRequestFolders(ctx.firm.metadata);

  const isInternal = (i: InboxIntake): boolean =>
    String(((i.intake_answers ?? {}) as Record<string, unknown>).submitted_by ?? '')
      .trim().length > 0;
  const internal = intakes.filter(isInternal);
  const external = intakes.filter((i) => !isInternal(i));

  const openInternal = internal.filter(
    (i) => i.status !== 'rejected' && i.status !== 'engaged',
  ).length;
  const openExternal = external.filter(
    (i) => i.status !== 'rejected' && i.status !== 'engaged',
  ).length;

  const tabs: TabDef[] = [
    {
      id: 'internal',
      label: 'Internal',
      badge: openInternal > 0 ? openInternal : undefined,
      content: (
        <IntakeInbox
          intakes={internal}
          folders={folders}
          emptyMessage="No internal requests yet. When an employee files a request from the Hub, it lands here."
        />
      ),
    },
    {
      id: 'external',
      label: 'External',
      badge: openExternal > 0 ? openExternal : undefined,
      content: (
        <IntakeInbox
          intakes={external}
          folders={folders}
          emptyMessage="No external requests yet. Outside-client matters and anything not filed by an employee will appear here."
        />
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Request inbox
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Where everything lands. <strong>Internal</strong> is what
          employees filed from the Hub.{' '}
          <strong>External</strong> is outside-client matters and
          anything not employee-filed. Need to create one yourself?{' '}
          <Link
            href="/counsel/intake"
            className="underline text-forest-900 dark:text-cream-100"
          >
            New intake
          </Link>
          .
        </p>
      </header>

      <Tabs swipe storageKey="counsel-inbox" tabs={tabs} />
    </div>
  );
}
