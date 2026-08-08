import 'server-only';

import { cache } from 'react';

import { createAdminSupabase } from './supabase/admin';
import { visibleIntakeIds, intakesAwaitingReply } from './portal-scope';
import { parseDueBy, isDueCurrent } from './portal-due';
import {
  PORTAL_REQUEST_FAMILIES,
  familyOfType,
  type PortalFamilyKey,
} from './portal-request-families';

/**
 * What the employee portal knows about one person's open requests.
 *
 * WHY IT IS A MODULE AND NOT A QUERY ON THE PAGE
 * ---------------------------------------------
 * Three surfaces now make the same claim out loud. The rail puts a
 * count badge on a request family, a home tile says "2 open with you",
 * and the banner appears only when something is genuinely waiting. If
 * any two of those counted differently the page would contradict
 * itself in the same viewport, which is worse than not counting at all.
 * So the count is computed once, here, from one predicate.
 *
 * `cache()` is React's per-request memo, not a cross-request cache.
 * The layout and the page render in the same pass, so the two of them
 * asking share one round trip; the next request re-reads. Nothing here
 * is cached between users, which for a per-user scope would be a leak
 * rather than an optimisation.
 *
 * OPEN MEANS NOT DECIDED
 * ----------------------
 * `rejected` and `closed` are the two statuses lib/portal-status.ts
 * shows the employee as "Closed". Everything else is still moving, so
 * everything else is open. This is stated once here rather than as a
 * `!== 'rejected'` on each page, which is what the home page used to
 * do and which counted a closed request as open.
 */

/** Statuses an employee sees as finished. Everything else is open. */
const DECIDED = new Set(['rejected', 'closed']);

export type PortalRequestRow = {
  id: string;
  client_name: string;
  matter_type: string | null;
  status: string;
  created_at: string;
  intake_answers: Record<string, unknown> | null;
};

export type PortalOpenRequests = {
  /** Every request this person can see, newest first, open or not. */
  rows: PortalRequestRow[];
  /** The open ones. */
  open: PortalRequestRow[];
  /** Open requests where legal has spoken last and is waiting on them. */
  awaitingYou: PortalRequestRow[];
  /** Open requests with a due date that has passed. */
  overdue: PortalRequestRow[];
  /** Open requests due within the window portal-due calls current. */
  dueSoon: PortalRequestRow[];
  /** Open requests per family key. A family with none is 0, never absent. */
  byFamily: Record<PortalFamilyKey, number>;
};

const EMPTY_BY_FAMILY = (): Record<PortalFamilyKey, number> =>
  Object.fromEntries(
    PORTAL_REQUEST_FAMILIES.map((f) => [f.key, 0]),
  ) as Record<PortalFamilyKey, number>;

/**
 * Group open requests by the tile that offered them.
 *
 * Exported and pure so the arithmetic is testable without a database.
 * A request whose `matter_type` belongs to no family (an outside-client
 * matter the legal team invited this person onto, or a type since
 * renamed) is counted in no tile, which is why the tiles never claim to
 * be the whole list and "My requests" is always reachable.
 */
export function countByFamily(
  rows: Pick<PortalRequestRow, 'matter_type'>[],
): Record<PortalFamilyKey, number> {
  const out = EMPTY_BY_FAMILY();
  for (const r of rows) {
    const family = familyOfType(r.matter_type);
    if (family) out[family.key] += 1;
  }
  return out;
}

/** True when the employee should still think of this request as live. */
export function isOpenStatus(status: string | null | undefined): boolean {
  return !DECIDED.has(String(status ?? '').trim());
}

export const loadPortalOpenRequests = cache(
  async (userId: string, firmId: string): Promise<PortalOpenRequests> => {
    const empty: PortalOpenRequests = {
      rows: [],
      open: [],
      awaitingYou: [],
      overdue: [],
      dueSoon: [],
      byFamily: EMPTY_BY_FAMILY(),
    };
    const admin = createAdminSupabase();
    if (!admin) return empty;

    const visible = await visibleIntakeIds(admin, userId, firmId);
    if (visible.length === 0) return empty;

    const { data } = await admin
      .from('firm_matter_intakes')
      .select('id, client_name, matter_type, status, created_at, intake_answers')
      .eq('firm_id', firmId)
      .in('id', visible)
      .order('created_at', { ascending: false })
      .limit(100);
    const rows = (data ?? []) as PortalRequestRow[];
    const open = rows.filter((r) => isOpenStatus(r.status));

    // "Awaiting you" reads firm_intake_messages, never the legacy
    // intake_answers.thread jsonb: that array stopped being written when
    // the conversation moved to its own table, and reading it told an
    // employee they were caught up while legal was waiting on them.
    const awaitingIds = await intakesAwaitingReply(
      admin,
      open.map((r) => r.id),
    );

    const now = Date.now();
    const withDue = open
      .map((r) => ({ r, due: parseDueBy(r.intake_answers) }))
      .filter((x): x is { r: PortalRequestRow; due: number } => x.due !== null);

    return {
      rows,
      open,
      awaitingYou: open.filter((r) => awaitingIds.has(r.id)),
      overdue: withDue.filter((x) => x.due < now).map((x) => x.r),
      dueSoon: withDue
        .filter((x) => x.due >= now && isDueCurrent(x.due, now))
        .sort((a, b) => a.due - b.due)
        .map((x) => x.r),
      byFamily: countByFamily(open),
    };
  },
);
