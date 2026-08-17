import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmMembers } from '@/lib/firm-storage';
import { firmVocabulary } from '@/lib/firm-vocabulary';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { readIntakeFolder, readRequestFolders } from '@/lib/request-folders';
import { intakeTitle } from '@/lib/intake-request';
import { refFor } from '@/lib/intake-notify';
import {
  normalizeIntakePriority,
  workflowStateOf,
} from '@/lib/intake-workflow';
import {
  INTAKE_LIST_READ_LIMIT,
  parseIntakeListParams,
  type IntakeListRow,
} from '@/lib/intake-list';
import { RequestsTable } from './requests-table';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request inbox · Counsel' };

/**
 * Everything landing on the legal team, as one queue.
 *
 * WHAT THIS REPLACED, and why. The page used to split the queue in two by who
 * sent it - Employees and External - and render each half as four lane groups
 * of cards. Two things were wrong with that beyond the look of it. Half the
 * work was always on the tab you were not looking at, which is a strange
 * default for a triage queue whose whole job is "what needs me next". And
 * every figure on it was a tally over a read capped at 200 rows: the lane
 * headings, the lane tiles and the count on each tab. A firm past its 200th
 * request read a floor with a total's label on it, which is a defect this
 * repo has now shipped four times elsewhere.
 *
 * So: one list, the source becomes a column filter (and the old
 * `?view=external` links keep meaning what they meant, see
 * parseIntakeListParams), and the two reads below are separated by what they
 * are for. One is bounded and draws rows. The other is an uncapped exact count
 * and is the only thing on the page allowed to be called a total.
 *
 * The reference the layout comes from is an IT service desk. The structure is
 * taken from it and none of the vocabulary is; lib/intake-list.ts says which
 * of its columns have no fact behind them here and what stands in their place.
 */
export default async function CounselInboxPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  // An in-house team opens requests, not intakes.
  const vocab = firmVocabulary(ctx.firm.firmType);
  const supabase = createServerSupabase();

  const [{ data: rows }, { count }, members, user] = await Promise.all([
    supabase
      .from('firm_matter_intakes')
      .select(
        'id, client_name, matter_type, jurisdiction_state, status, workflow_state, assigned_to, created_at, updated_at, intake_answers, request_number',
      )
      .eq('firm_id', ctx.firm.id)
      .order('created_at', { ascending: false })
      .limit(INTAKE_LIST_READ_LIMIT),

    // The firm's total, and the only figure on this page that claims to be
    // one. `head: true` so it is a count and not a second copy of the rows.
    supabase
      .from('firm_matter_intakes')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', ctx.firm.id),

    listFirmMembers(ctx.firm.id),
    getCurrentUser(),
  ]);

  const folders = readRequestFolders(ctx.firm.metadata);
  const folderName = new Map(folders.map((f) => [f.key, f.name]));

  const memberLabel = new Map<string, string>();
  for (const m of members) {
    memberLabel.set(m.userId, m.displayName ?? m.email ?? 'Member');
  }

  type IntakeReadRow = {
    id: string;
    client_name: string | null;
    matter_type: string | null;
    jurisdiction_state: string | null;
    status: string | null;
    workflow_state: string | null;
    assigned_to: string | null;
    created_at: string;
    updated_at: string | null;
    intake_answers: Record<string, unknown> | null;
    // The firm's allocated reference. Null on every request filed before
    // 20260817_request_number.sql, which is permanent and is what keeps a
    // reference already emailed out still findable in this queue's filter.
    request_number: string | null;
  };

  const read = (rows ?? []) as IntakeReadRow[];
  const firmTotal = count ?? read.length;
  // Whether the bounded read reached the whole queue. The table states the
  // boundary when it did not, rather than letting a figure over part of the
  // history read as a figure over all of it.
  const loadedAll = read.length >= firmTotal;

  const list: IntakeListRow[] = read.map((r) => {
    const answers = (r.intake_answers ?? {}) as Record<string, unknown>;
    // Filed by one of the client's own people, whichever door they used: the
    // Hub stamps submitted_by and a partner app stamps intake_answers.partner.
    const submittedBy = String(answers.submitted_by ?? '').trim();
    const inHouse = submittedBy.length > 0 || answers.partner != null;
    const folderKey = readIntakeFolder(r.intake_answers);
    return {
      id: r.id,
      reference: refFor(r),
      subject: intakeTitle(r),
      matterType: r.matter_type,
      jurisdiction: r.jurisdiction_state,
      folder: (folderKey && folderName.get(folderKey)) || '',
      // client_name holds the REQUESTER on the partner path and on outside
      // traffic; intakeTitle above is what stops it being read as the subject.
      requesterName: submittedBy || (r.client_name ?? '').trim() || 'Not given',
      inHouse,
      priority: normalizeIntakePriority(answers.priority),
      state: workflowStateOf(r.workflow_state, r.status),
      assignedTo: r.assigned_to,
      assigneeLabel: r.assigned_to
        ? (memberLabel.get(r.assigned_to) ?? 'Member')
        : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
    };
  });

  const meId = user?.id ?? null;
  // The whole of the list's state is the query string. Parsed here so the
  // server decides what a URL means, and so a link the table writes is a link
  // this page reads back. See lib/intake-list.ts.
  const params = parseIntakeListParams(searchParams ?? {}, meId);

  const ownerOptions = [
    { value: '', label: 'Anyone' },
    { value: 'me', label: 'Assigned to me' },
    { value: 'unassigned', label: 'Unassigned' },
    ...members.map((m) => ({
      value: m.userId,
      label: memberLabel.get(m.userId) ?? 'Member',
    })),
  ];

  // The pickers that WRITE an owner take firm members only: "me" and
  // "unassigned" narrow a list, they are not people a request can be given to.
  const memberOptions = members.map((m) => ({
    userId: m.userId,
    label: memberLabel.get(m.userId) ?? 'Member',
  }));

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel</T>}
        title={<T>Request inbox</T>}
        // The controls under this are visible; a subtitle listing them is a
        // manual for a screen you are already looking at. What is left is what
        // a subtitle is for: how much there is, and whose it is.
        subtitle={
          <>
            <span className="tabular-nums">{firmTotal}</span>{' '}
            <T>requests at</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>
          </>
        }
        action={
          <Link href="/counsel/intake" className="btn-primary">
            <T>{vocab.intake}</T>
          </Link>
        }
      />

      {firmTotal === 0 ? (
        <EmptyState
          title={<T>Nothing has been filed yet.</T>}
          sub={
            <>
              <T>
                Requests your people file from the Hub or a connected workplace
                app land here, alongside anything from outside. You can also
              </T>{' '}
              <Link href="/counsel/intake" className="underline">
                <T>open one yourself</T>
              </Link>
              .
            </>
          }
        />
      ) : (
        <RequestsTable
          rows={list}
          params={params}
          ownerOptions={ownerOptions}
          members={memberOptions}
          meId={meId}
          firmTotal={firmTotal}
          loadedAll={loadedAll}
        />
      )}
    </div>
  );
}
