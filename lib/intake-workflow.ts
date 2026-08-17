/**
 * How the legal team says a ticket is going, as distinct from where the
 * request sits in the firm's intake lifecycle.
 *
 * WHY THERE ARE TWO. `firm_matter_intakes.status` has a CHECK constraint over
 * seven values (`in_progress`, `conflict_check_passed`,
 * `conflict_check_flagged`, `engaged`, `converted`, `rejected`, `closed`) and
 * those seven drive a great deal that is nowhere near this screen:
 * lib/intake-lanes.ts maps them onto the four queue lanes; lib/portal-status.ts
 * collapses them onto the four words an employee reads; lib/partner-tickets.ts
 * returns one of them over a live external API; app/api/cron/partner-reminders
 * selects on them; and lib/portal-open-requests.ts decides "you have N requests
 * open" from them.
 *
 * The nine states below are a different question. They answer "what is
 * happening with this ticket right now", which is what an in-house counsel
 * manages a queue by, and which the seven cannot express: there is no way to
 * say "waiting on the other side's signature" in a vocabulary whose finest
 * distinction is whether a conflict check passed.
 *
 * So the nine are stored in their own column and the seven are left alone.
 * Writing one of the nine also keeps the legacy column in the right LANE, via
 * legacyStatusForWorkflow below, which is what stops this screen from making a
 * ticket disappear out of somebody else's queue. Widening the CHECK instead
 * would have parked every `awaiting_*` ticket in "Needs attention" forever
 * (lib/intake-lanes.ts sends an unrecognised status there on purpose), told the
 * employee "Received" about a finished ticket, and emitted words the partner
 * integration has never seen.
 *
 * Relative imports, not '@/': lib modules are loaded by the test runner
 * without the Next.js path alias.
 */

import {
  DECIDED_INTAKE_STATUSES,
  INTAKE_STATUSES,
  type IntakeLane,
  type IntakeStatus,
} from './intake-lanes';
import { PILL_COLORS, type PillTone } from './pill-colors';

/**
 * The nine, in the order the owner gave them, which is also the order a ticket
 * travels: arrival, work, the three ways work stalls, the document outcome,
 * then the three ways it ends.
 */
export const INTAKE_WORKFLOW_STATES = [
  'new',
  'open',
  'awaiting_signatures',
  'awaiting_employee',
  'awaiting_external_party',
  'signed',
  'completed',
  'closed',
  'cancelled',
] as const;

export type IntakeWorkflowState = (typeof INTAKE_WORKFLOW_STATES)[number];

/** Sentence case, because these are states and not headlines. */
export const WORKFLOW_LABEL: Record<IntakeWorkflowState, string> = {
  new: 'New',
  open: 'Open',
  awaiting_signatures: 'Awaiting signatures',
  awaiting_employee: 'Awaiting employee',
  awaiting_external_party: 'Awaiting external party',
  signed: 'Signed',
  completed: 'Completed',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/**
 * The states that mean the legal team is finished with the ticket.
 *
 * Named as a set rather than tested for one at a time, for the reason
 * lib/intake-lanes.ts gives about DECIDED_INTAKE_STATUSES: the employee's open
 * count and this screen have to agree about what "finished" means, and two
 * hand-written lists of the same words is how they stop agreeing.
 */
export const DECIDED_WORKFLOW_STATES: readonly IntakeWorkflowState[] = [
  'completed',
  'closed',
  'cancelled',
];

/**
 * The queue lane each state lands in.
 *
 * This is a CLAIM, and tests/ticket-workspace.test.ts checks it against the
 * lane the written legacy status actually reaches. A state that claimed one
 * lane and produced another would be a queue that lies about itself.
 */
export const WORKFLOW_LANE: Record<IntakeWorkflowState, IntakeLane> = {
  new: 'attention',
  open: 'attention',
  awaiting_signatures: 'review',
  awaiting_employee: 'review',
  awaiting_external_party: 'review',
  signed: 'review',
  completed: 'closed',
  closed: 'closed',
  cancelled: 'closed',
};

/**
 * Semantic colour per state, and deliberately not the accent.
 *
 * docs/DESIGN.md: good, warning and critical are their own hues and never
 * borrow gold, or an alert stops reading as an alert. Gold is spent once on
 * this screen and it is spent on the action bar's primary, so nothing here is
 * `gold`.
 *
 * The three waiting states share one amber because they are one condition
 * (somebody outside this team owes us something) and three ambers would be
 * three distinctions the reader cannot use.
 */
export const WORKFLOW_TONE: Record<IntakeWorkflowState, PillTone> = {
  new: 'info',
  open: 'neutral',
  awaiting_signatures: 'waiting',
  awaiting_employee: 'waiting',
  awaiting_external_party: 'waiting',
  signed: 'good',
  completed: 'good',
  closed: 'quiet',
  cancelled: 'quiet',
};

/** The hex StatusPill wants, for a state. */
export function workflowColor(state: IntakeWorkflowState): string {
  return PILL_COLORS[WORKFLOW_TONE[state]];
}

/**
 * The four words a request's priority can be.
 *
 * Named here rather than a third time in the management block, because there
 * were already two copies: the list the intake form offers, and the rank and
 * tone maps the inbox sorts and paints by. A third would have been the copy
 * that finally drifted, and a priority the queue cannot rank is a request that
 * sorts as Normal whatever it says.
 *
 * Ordered least to most urgent, which is the order the form already offers and
 * the reverse of the order the inbox sorts by.
 */
export const INTAKE_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const;

export type IntakePriority = (typeof INTAKE_PRIORITIES)[number];

/** The word a request's priority is, given whatever is stored. */
export function normalizeIntakePriority(raw: unknown): IntakePriority {
  const v = String(raw ?? '').trim();
  return (INTAKE_PRIORITIES as readonly string[]).includes(v)
    ? (v as IntakePriority)
    : 'Normal';
}

/**
 * How urgent a priority is, as a number a queue can sort by.
 *
 * Read off INTAKE_PRIORITIES rather than written out again, because the array
 * is already ordered least to most urgent and a hand-written rank map is the
 * copy that drifts: an unranked priority sorts as Normal whatever it says.
 */
export function intakePriorityRank(p: IntakePriority): number {
  return INTAKE_PRIORITIES.indexOf(p);
}

function isWorkflowState(v: unknown): v is IntakeWorkflowState {
  return INTAKE_WORKFLOW_STATES.includes(v as IntakeWorkflowState);
}

/**
 * What a ticket's workflow state reads as, given the stored column and the
 * legacy status.
 *
 * The column arrives with a migration the owner applies, so it is null for
 * every request filed before that and for every request until somebody sets
 * one. Deriving rather than rendering blank is the difference between a screen
 * that has not been told and a screen that looks broken.
 *
 * The derivation never crosses the open/decided line: a decided legacy status
 * derives a decided state and an open one derives an open state. Crossing it
 * would put a word on the screen that contradicts the queue the ticket is
 * actually in.
 *
 * A stored value that is not one of the nine falls back to the derivation.
 * As far as this code knows the column is free text: the CHECK constraint is
 * the database's promise, not this module's.
 */
export function workflowStateOf(
  stored: string | null | undefined,
  status: string | null | undefined,
): IntakeWorkflowState {
  if (isWorkflowState(stored)) return stored;
  switch (String(status ?? '')) {
    case 'rejected':
    case 'closed':
      return 'closed';
    case 'conflict_check_passed':
    case 'conflict_check_flagged':
    case 'engaged':
    case 'converted':
      return 'open';
    default:
      return 'new';
  }
}

export type WorkflowWrite =
  | { ok: true; status: IntakeStatus | null }
  | { ok: false; error: string };

/**
 * The legacy status to write alongside a new workflow state, or null for
 * "leave it where it is".
 *
 * Two rules keep the seven-value column truthful, and each is a defect this
 * repo would otherwise have shipped.
 *
 * CONVERTED IS NEVER OVERWRITTEN. A converted request has a matter behind it
 * and its lifecycle has moved past intake. Saying "we are waiting on their
 * signature" is a note about how the work is going, not a reason to unlink the
 * matter and drop the ticket back into the triage lane.
 *
 * A LIVE STATE ON A DECIDED REQUEST IS REFUSED, rather than quietly reopening
 * it. reopenIntakeAction is the path that reopens: it restores the status the
 * request held before the decision, clears the stored decision so the pages
 * stop reporting one that no longer holds, and writes the reversal onto the
 * request's trail. A status flipped from this block would do none of those and
 * would leave a request that reads as open while still carrying a recorded
 * refusal the employee has already been shown.
 */
export function legacyStatusForWorkflow(
  state: IntakeWorkflowState,
  current: string | null | undefined,
): WorkflowWrite {
  const now = String(current ?? '');
  const decidedNow = DECIDED_INTAKE_STATUSES.includes(now as IntakeStatus);

  // Switched over the union rather than tested one member at a time, so a
  // tenth state added later is a compile error here instead of a silent
  // default. lib/firm-authz.ts uses the same shape for the same reason.
  switch (state) {
    case 'completed':
    case 'closed':
    case 'cancelled':
      // An ending, including on a converted request: a matter having been
      // opened is not a reason to tell the employee "Accepted" forever about
      // work that is finished. The matter link itself is untouched.
      return { ok: true, status: 'closed' };

    case 'new':
    case 'open':
    case 'awaiting_signatures':
    case 'awaiting_employee':
    case 'awaiting_external_party':
    case 'signed': {
      if (decidedNow) {
        return {
          ok: false,
          error:
            'This request has been decided. Reopen it first, so the person who filed it is told.',
        };
      }
      if (now === 'converted') return { ok: true, status: null };
      // New and Open both sit in the triage lane, which is where an undecided
      // request already is, so neither moves anything. Being blocked on
      // somebody is work in progress rather than work waiting to be triaged,
      // so the other four move it out of "Needs attention".
      const triage = state === 'new' || state === 'open';
      return { ok: true, status: triage ? null : 'conflict_check_passed' };
    }

    default: {
      const unhandled: never = state;
      throw new Error(
        `intake-workflow has no rule for the state ${String(unhandled)}.`,
      );
    }
  }
}

/**
 * The six states that mean the ticket is still on the legal team's desk: the
 * nine, less the three that mean it is finished.
 *
 * Derived rather than written out. A tenth state added to INTAKE_WORKFLOW_STATES
 * lands here automatically, which is the difference between one definition and
 * two lists that agree until somebody edits one of them.
 */
const LIVE_WORKFLOW_STATES: readonly IntakeWorkflowState[] =
  INTAKE_WORKFLOW_STATES.filter((s) => !DECIDED_WORKFLOW_STATES.includes(s));

/**
 * The legacy statuses that mean a row with no `workflow_state` is finished.
 *
 * Obtained by ASKING workflowStateOf, rather than by restating its switch, so
 * the two cannot come apart. Today this is `rejected` and `closed`.
 */
const DECIDED_LEGACY_STATUSES: readonly IntakeStatus[] = INTAKE_STATUSES.filter(
  (s) => DECIDED_WORKFLOW_STATES.includes(workflowStateOf(null, s)),
);

/**
 * The PostgREST `.or()` argument that selects exactly the open tickets, for
 * the surfaces that COUNT the queue rather than tally rows they have read.
 *
 * This exists for the same reason lib/intake-lanes.ts grew intakeLaneFilter: a
 * total over a bounded read is a floor with a total's label on it, so a surface
 * that states the queue's size has to ask the database for it, and the
 * expression it asks with belongs beside the definition rather than inline on
 * the page.
 *
 * THREE BRANCHES, and each one is a row that would otherwise be miscounted.
 * `workflow_state` is nullable and was deliberately never backfilled (see
 * supabase/migrations/20260816_intake_workflow_state.sql), so for a legacy row
 * the derivation in workflowStateOf is the only thing that knows whether the
 * request is finished:
 *
 *   1. A stored state, live.
 *   2. No stored state, and a status that is not one of the decided ones.
 *   3. No stored state and no status at all. Named on its own because SQL's
 *      `NOT IN` over NULL is NULL rather than true, so branch 2 drops this row
 *      and it would vanish from a queue it has every reason to be in.
 *
 * Anything unrecognised therefore counts as OPEN, which is the direction
 * lib/intake-lanes.ts chose for the same reason: a request the code cannot
 * place should reach a person rather than disappear into a finished bucket.
 */
export function openIntakeOrFilter(): string {
  return [
    `workflow_state.in.(${LIVE_WORKFLOW_STATES.join(',')})`,
    `and(workflow_state.is.null,status.not.in.(${DECIDED_LEGACY_STATUSES.join(',')}))`,
    'and(workflow_state.is.null,status.is.null)',
  ].join(',');
}
