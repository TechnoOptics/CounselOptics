import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { firmVocabulary } from '@/lib/firm-vocabulary';
import { createServerSupabase } from '@/lib/supabase/server';
import { readRequestFolders } from '@/lib/request-folders';
import { isIntakeOpen } from '@/lib/intake-lanes';
import { IntakeInbox, type InboxIntake } from '@/components/counsel/IntakeInbox';
import { ViewStrip, type ViewOption } from '@/components/counsel/patterns';
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
 * Each view uses the same lanes (Needs attention / In review /
 * Accepted / Closed) so daily triage feels identical regardless of
 * source. Creating a new intake lives on /counsel/intake.
 *
 * The two views are the list pattern's segmented strip and live in the
 * query string, which is a deliberate change from the shared <Tabs>
 * this page used to mount. It buys what the matter list already has:
 * a triage queue is a link a colleague can be sent, the back button
 * steps between views, and a refresh keeps your place. It costs the
 * mobile swipe and the remembered tab that <Tabs> provided, and only
 * the view being looked at is rendered now.
 */
export default async function CounselInboxPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  // The "create one yourself" link names the thing it creates, which an
  // in-house team calls a request.
  const vocab = firmVocabulary(ctx.firm.firmType);
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

  // The tab badge counts OPEN requests: needs attention plus in review. That
  // is deliberately a wider measure than the "Needs attention" lane tile
  // below it, and the subtitle now says so - the two numbers disagreeing with
  // no explanation was the confusing part, not the numbers themselves. (It
  // also used to count converted and closed requests as open.)
  const openInternal = internal.filter((i) => isIntakeOpen(i.status)).length;
  const openExternal = external.filter((i) => isIntakeOpen(i.status)).length;

  const rawView = searchParams?.view;
  const viewParam = Array.isArray(rawView) ? rawView[0] : rawView;
  const view = viewParam === 'external' ? 'external' : 'internal';

  // The count on each option is the open requests that option would
  // show, from the same isIntakeOpen predicate the lanes use.
  const options: ViewOption[] = [
    { key: 'internal', label: <T>Employees</T>, count: openInternal },
    { key: 'external', label: <T>External</T>, count: openExternal },
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
            only. The number on each view counts every open request, which is
            the Needs attention lane plus the In review lane. The view is in the
            address bar, so a queue can be sent to a colleague. Need to create
            one yourself?</T>{' '}
            <Link
              href="/counsel/intake"
              className="underline text-foreground"
            >
              <T>{vocab.intake}</T>
            </Link>
            .
          </>
        }
      />

      <ViewStrip
        label="Request views"
        options={options}
        active={view}
        href={(k) =>
          k === 'internal' ? '/counsel/inbox' : `/counsel/inbox?view=${k}`
        }
      />

      {view === 'internal' ? (
        <IntakeInbox
          intakes={internal}
          folders={folders}
          emptyMessage="No employee requests yet. Requests filed from the Hub or a connected workplace app (like Zinpro One) land here."
        />
      ) : (
        <IntakeInbox
          intakes={external}
          folders={folders}
          emptyMessage="No external requests yet. Only outside-client matters appear here - employee requests never do."
        />
      )}
    </div>
  );
}
