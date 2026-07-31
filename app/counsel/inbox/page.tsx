import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { readRequestFolders } from '@/lib/request-folders';
import { IntakeInbox, type InboxIntake } from '@/components/counsel/IntakeInbox';
import { Tabs, type TabDef } from '@/components/Tabs';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

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

  // Employee-filed means filed BY an employee, whichever door they used: the
  // Hub stamps submitted_by, and a partner app (Zinpro One) stamps
  // intake_answers.partner. Both are the client's own people - only matters
  // with neither stamp are genuinely outside traffic.
  const isInternal = (i: InboxIntake): boolean => {
    const a = (i.intake_answers ?? {}) as Record<string, unknown>;
    return String(a.submitted_by ?? '').trim().length > 0 || a.partner != null;
  };
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
      label: 'Employees',
      badge: openInternal > 0 ? openInternal : undefined,
      content: (
        <IntakeInbox
          intakes={internal}
          folders={folders}
          emptyMessage="No employee requests yet. Requests filed from the Hub or a connected workplace app (like Zinpro One) land here."
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
          emptyMessage="No external requests yet. Only outside-client matters appear here - employee requests never do."
        />
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel</T>}
        title={<T>Request inbox</T>}
        subtitle={
          <>
            <T>Where everything lands.</T> <strong><T>Employees</T></strong>{' '}
            <T>is what your people filed - from the Hub or a connected
            workplace app.</T>{' '}
            <strong><T>External</T></strong> <T>is outside-client matters
            only. Need to create one yourself?</T>{' '}
            <Link
              href="/counsel/intake"
              className="underline text-forest-900 dark:text-cream-100"
            >
              <T>New intake</T>
            </Link>
            .
          </>
        }
      />

      <Tabs swipe storageKey="counsel-inbox" tabs={tabs} />
    </div>
  );
}
