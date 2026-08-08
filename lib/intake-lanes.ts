/**
 * The single definition of what an intake request's status means.
 *
 * Four surfaces used to count the same queue four different ways:
 *
 *   /counsel        "1 thing needs a human" (rows drawn, not work items)
 *   /counsel        "5 requests need attention"
 *   /counsel/inbox  tab badge 5, lane "Needs attention" 4 + "In review" 1
 *   /counsel/analytics "Open requests" 5
 *
 * The 5-vs-4 split was a real bug, not a difference of opinion: the dashboard
 * tested for a status named `in_review`, which the schema has never allowed
 * (see supabase/migrations/20260726_intake_status_lifecycle.sql), so every
 * conflict-cleared request fell through its else-branch into "needs attention".
 * `converted` and `closed` had no home in any of the maps either, which is why
 * a CONVERTED request sat in the "Needs attention" lane.
 *
 * There are genuinely two measures here, and they are now named as such:
 *
 *   - "Needs attention": untriaged or flagged. Somebody has to look at it.
 *   - "Open": needs attention PLUS in review. Not yet accepted or closed.
 *
 * Everything that counts requests imports from this file.
 */

/**
 * Every status the `firm_matter_intakes.status` CHECK constraint allows.
 *
 * Not every member of this list has a writer, and the difference matters.
 * `conflict_check_passed`, `conflict_check_flagged` and `converted` are
 * written by the conflict check and by convertIntakeToCaseAction;
 * `rejected` and `closed` are written by decideIntakeAction (see
 * INTAKE_DECISIONS below).
 *
 * `engaged` is written by nothing, and this file is the reason it should
 * probably not exist. It shares the `accepted` lane with `converted`, it
 * collapses onto the same "Accepted" word in lib/portal-status.ts, and the
 * product's one accept path opens a matter and writes `converted`. So
 * "engaged" would have to mean "taken on, but with no matter behind it",
 * which nothing in this product can represent or act on. Removing it from
 * the CHECK constraint is the owner's call and needs a look at live data
 * first; declaring it here is not evidence that anything can reach it.
 */
export const INTAKE_STATUSES = [
  'in_progress',
  'conflict_check_passed',
  'conflict_check_flagged',
  'engaged',
  'converted',
  'rejected',
  'closed',
] as const;

export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export type IntakeLane = 'attention' | 'review' | 'accepted' | 'closed';

/** Which statuses sit in which lane. Exhaustive over INTAKE_STATUSES. */
export const INTAKE_LANE_STATUSES: Record<IntakeLane, readonly IntakeStatus[]> = {
  attention: ['in_progress', 'conflict_check_flagged'],
  review: ['conflict_check_passed'],
  accepted: ['engaged', 'converted'],
  closed: ['rejected', 'closed'],
};

export const INTAKE_LANE_LABEL: Record<IntakeLane, string> = {
  attention: 'Needs attention',
  review: 'In review',
  accepted: 'Accepted',
  closed: 'Closed',
};

export const INTAKE_LANE_BLURB: Record<IntakeLane, string> = {
  attention: 'New and flagged. Triage these first',
  review: 'Cleared conflict check, being worked',
  accepted: 'Engaged or converted to a matter',
  closed: 'Rejected or completed',
};

const LANE_BY_STATUS = new Map<string, IntakeLane>(
  (Object.keys(INTAKE_LANE_STATUSES) as IntakeLane[]).flatMap((lane) =>
    INTAKE_LANE_STATUSES[lane].map((s) => [s, lane] as const),
  ),
);

/**
 * An unrecognised status lands in "Needs attention" on purpose: a request the
 * code does not understand is exactly the kind that should reach a person,
 * rather than disappearing into an "accepted" or "closed" bucket.
 */
export function intakeLaneOf(status: string | null | undefined): IntakeLane {
  return LANE_BY_STATUS.get(String(status ?? '')) ?? 'attention';
}

/** Open = still on the legal team's plate: needs attention, or in review. */
export const OPEN_INTAKE_STATUSES: readonly IntakeStatus[] = [
  ...INTAKE_LANE_STATUSES.attention,
  ...INTAKE_LANE_STATUSES.review,
];

export function isIntakeOpen(status: string | null | undefined): boolean {
  const lane = intakeLaneOf(status);
  return lane === 'attention' || lane === 'review';
}

/**
 * The statuses that mean the firm has finished with a request.
 *
 * This is the `closed` lane, named. lib/portal-open-requests.ts used to
 * repeat the same two strings as a literal set of its own, which is how the
 * employee's "N requests open" and the counsel Closed lane could have come to
 * disagree about what "decided" means. There is one list now and both read
 * it.
 */
export const DECIDED_INTAKE_STATUSES: readonly IntakeStatus[] =
  INTAKE_LANE_STATUSES.closed;

/**
 * The decisions the legal team can record to stop work on a request, and the
 * status each one writes.
 *
 * Two, because they are two different facts about a legal matter and the
 * firm's own record should not blur them. `declined` is "we are not taking
 * this on". `closed_out` is "there is nothing further to do": withdrawn,
 * duplicated, or handled somewhere else. Recording a completed request as
 * rejected would be a wrong record, and recording a refusal as merely closed
 * would lose the refusal.
 *
 * Both land in the same lane and both read as "Closed" to the employee, which
 * is correct: what they need to know is that it is decided and why, and the
 * why is the note, not the enum.
 *
 * Every value here MUST be a decided status. tests/intake-decision.test.ts
 * pins that, because an outcome that wrote a status the portal still counts
 * as open would leave the employee's count exactly as broken as it was
 * before, with a button in front of it.
 */
export const INTAKE_DECISIONS = {
  declined: 'rejected',
  closed_out: 'closed',
} as const satisfies Record<string, IntakeStatus>;

export type IntakeDecision = keyof typeof INTAKE_DECISIONS;

/** Longest decision note kept. Long enough for a paragraph of reasoning. */
export const INTAKE_DECISION_NOTE_MAX = 2000;

/**
 * Where a reopened request goes when the stored previous status cannot be
 * used. "Needs attention" is the deliberate direction, for the reason
 * intakeLaneOf gives: a request nobody can place should reach a person.
 */
export const REOPENED_INTAKE_STATUS: IntakeStatus = 'in_progress';

/**
 * The status a reopen should restore, given whatever was stored at decision
 * time. Anything unrecognised, or itself decided, falls back to the queue.
 */
export function reopenedIntakeStatus(
  previous: string | null | undefined,
): IntakeStatus {
  const p = String(previous ?? '') as IntakeStatus;
  if (!INTAKE_STATUSES.includes(p)) return REOPENED_INTAKE_STATUS;
  if (DECIDED_INTAKE_STATUSES.includes(p)) return REOPENED_INTAKE_STATUS;
  return p;
}

export type IntakeLaneTally = Record<IntakeLane, number>;

export function tallyIntakeLanes(
  statuses: Array<string | null | undefined>,
): IntakeLaneTally {
  const tally: IntakeLaneTally = {
    attention: 0,
    review: 0,
    accepted: 0,
    closed: 0,
  };
  for (const s of statuses) tally[intakeLaneOf(s)] += 1;
  return tally;
}
