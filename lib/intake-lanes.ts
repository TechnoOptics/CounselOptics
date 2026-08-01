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

/** Every status the `firm_matter_intakes.status` CHECK constraint allows. */
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
