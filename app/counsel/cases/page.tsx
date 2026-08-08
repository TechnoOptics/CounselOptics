import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmCases,
  listFirmMembers,
} from '@/lib/firm-storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { STATUS_LABEL, type CaseStatus } from '@/lib/types';
import { T } from '@/components/i18n/LocaleProvider';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { PILL_COLORS } from '@/components/counsel/StatusPill';
import { parseMatterListParams, type MatterRow } from '@/lib/matter-list';
import { NewMatterButton } from './new-matter-button';
import { MattersTable } from './matters-table';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Matters · Counsel' };

// One hex per case status; StatusPill derives the fill and the border
// from it. `archived` used to share `closed`'s grey because the dimmer
// grey that sets it apart, PILL_COLORS.quiet, measured about 3.9:1 on a
// counsel card and failed AA at chip size. `quiet` has since been lifted
// to 4.71:1, so archived can read as the quieter of the two again.
const STATUS_COLOR: Record<CaseStatus, string> = {
  draft: PILL_COLORS.neutral,
  open: PILL_COLORS.good,
  under_review: PILL_COLORS.info,
  needs_evidence: PILL_COLORS.waiting,
  export_ready: PILL_COLORS.good,
  closed: PILL_COLORS.neutral,
  archived: PILL_COLORS.quiet,
};

const STATUSES = Object.keys(STATUS_COLOR) as CaseStatus[];

export default async function CounselCasesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const [allCases, members, user] = await Promise.all([
    listFirmCases(ctx.firm.id),
    listFirmMembers(ctx.firm.id),
    getCurrentUser(),
  ]);

  // Resolve assignee display names once (userId -> label).
  const memberLabel = new Map<string, string>();
  for (const m of members) {
    memberLabel.set(m.userId, m.displayName ?? m.email ?? 'Member');
  }

  const rows: MatterRow[] = allCases.map((c) => ({
    id: c.id,
    title: c.title,
    subjectName: c.subjectName,
    caseType: c.caseType,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status] ?? c.status,
    statusColor: STATUS_COLOR[c.status] ?? PILL_COLORS.neutral,
    assignedTo: c.assignedTo ?? null,
    assigneeLabel: c.assignedTo
      ? (memberLabel.get(c.assignedTo) ?? 'Member')
      : null,
    hearingAt: c.hearingAt ?? null,
    updatedAt: c.updatedAt,
  }));

  // The whole of the list's state is the query string: which view,
  // which column filters, which sort, which page. Parsed here so the
  // server decides what a URL means, and so a link the table writes is
  // a link this page reads back. See lib/matter-list.ts.
  const params = parseMatterListParams(searchParams, user?.id ?? null);

  const assigneeOptions = [
    { value: '', label: 'Everyone' },
    { value: 'me', label: 'Assigned to me' },
    { value: 'unassigned', label: 'Unassigned' },
    ...members.map((m) => ({
      value: m.userId,
      label: memberLabel.get(m.userId) ?? 'Member',
    })),
  ];

  // The pickers that WRITE an assignee take firm members only: "me" and
  // "unassigned" narrow a list, they are not people a matter can be
  // given to.
  const memberOptions = members.map((m) => ({
    userId: m.userId,
    label: memberLabel.get(m.userId) ?? 'Member',
  }));

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · matters</T>}
        title={<T>Firm caseload</T>}
        subtitle={
          <>
            {allCases.length} <T>matters at</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>.{' '}
            <T>Search, filter every column and sort the matter, status, assignee, hearing and updated columns; reassign a matter in its row, or several at once. The view, the filters and the page are in the address bar, so a narrowed queue can be sent to a colleague.</T>
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/counsel/import" className="btn-secondary">
              <T>Import data</T>
            </Link>
            <NewMatterButton firmId={ctx.firm.id} />
          </div>
        }
      />

      {allCases.length === 0 ? (
        <EmptyState
          title={<T>No matters yet.</T>}
          sub={
            <>
              <T>
                Open one with &ldquo;New matter&rdquo; above, or import your
                existing caseload: upload a spreadsheet or migrate from
                another platform on the
              </T>{' '}
              <Link href="/counsel/import" className="underline">
                <T>Import data</T>
              </Link>{' '}
              <T>page.</T>
            </>
          }
        />
      ) : (
        <MattersTable
          rows={rows}
          params={params}
          assigneeOptions={assigneeOptions}
          members={memberOptions}
          statusOptions={STATUSES.map((s) => ({
            value: s,
            label: STATUS_LABEL[s] ?? s,
          }))}
          meId={user?.id ?? null}
        />
      )}
    </div>
  );
}
