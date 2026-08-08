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
import { NewMatterButton } from './new-matter-button';
import { MattersTable, type MatterRow } from './matters-table';

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
  searchParams: { assignee?: string };
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

  // `?assignee=` still narrows the list on arrival, so links that were
  // handed out while the filter lived in the URL keep working. The
  // table owns it from then on.
  const assigneeOptions = [
    { value: '', label: 'Everyone' },
    { value: 'me', label: 'Assigned to me' },
    { value: 'unassigned', label: 'Unassigned' },
    ...members.map((m) => ({
      value: m.userId,
      label: memberLabel.get(m.userId) ?? 'Member',
    })),
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · matters</T>}
        title={<T>Firm caseload</T>}
        subtitle={
          <>
            {allCases.length} <T>matters at</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>,{' '}
            <T>all on one page. Search title, client, matter type and assignee; narrow by view, status or assignee; sort the matter, status, assignee, hearing and updated columns.</T>
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
          assigneeOptions={assigneeOptions}
          statusOptions={STATUSES.map((s) => ({
            value: s,
            label: STATUS_LABEL[s] ?? s,
          }))}
          meId={user?.id ?? null}
          initialAssignee={(searchParams.assignee ?? '').trim()}
        />
      )}
    </div>
  );
}
