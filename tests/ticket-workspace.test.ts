import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  INTAKE_WORKFLOW_STATES,
  WORKFLOW_LABEL,
  WORKFLOW_LANE,
  WORKFLOW_TONE,
  DECIDED_WORKFLOW_STATES,
  workflowStateOf,
  legacyStatusForWorkflow,
  type IntakeWorkflowState,
} from '../lib/intake-workflow';
import {
  INTAKE_STATUSES,
  DECIDED_INTAKE_STATUSES,
  intakeLaneOf,
  isIntakeOpen,
} from '../lib/intake-lanes';
import { portalStatusLabel } from '../lib/portal-status';
import {
  edgeRevealDecision,
  EDGE_ZONE_PX,
  EDGE_DWELL_MS,
  type EdgeSample,
} from '../lib/sidebar-edge-reveal';

/**
 * The legal team's ticket workspace.
 *
 * Two halves. The first is the workflow vocabulary, which is the part that
 * could quietly break somebody else's screen: the owner asked for nine status
 * values and `firm_matter_intakes.status` allows seven different ones, which
 * ten modules switch on. The second is the layout, which is the part that
 * tests cannot see at all and so is pinned by reading the source.
 *
 * Every source anchor strips comments first. A comment explaining a fix
 * contains the string a guard searches for, and this repo has already found
 * guards passing while the thing they guarded was gone.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

/**
 * The source of a file with its comments gone.
 *
 * EVERY assertion below reads this rather than the raw file, which is the
 * whole point: five guards in this repo have been found passing because the
 * comment explaining the fix contained the string the guard searched for.
 *
 * Stripping is not string-aware, so it can take out more than it should. That
 * direction is safe here and it is worth saying why rather than adding
 * machinery that looks like it is protecting something. Every check below
 * asserts that an anchor is PRESENT. If stripping removed a real occurrence,
 * the assertion goes red and somebody looks. The dangerous direction, a guard
 * that passes on prose, is closed by construction because prose is gone before
 * anything is matched.
 *
 * The counting guard in tests/firm-access.test.ts exists for the opposite
 * shape: there the assertions are about ABSENCE (no catch around a gate), and
 * absence is satisfied by over-stripping.
 */
function codeOf(rel: string): string {
  return stripComments(read(rel));
}

/** SQL comments, so a migration's prose cannot satisfy a check either. */
const stripSql = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const PAGE = 'app/counsel/intake/[id]/page.tsx';
const SIDEBAR = 'components/counsel/SidebarFocus.tsx';

describe('the nine workflow states the owner asked for', () => {
  /** Mutation: drop or rename one value. */
  it('are exactly the nine, in the owner’s order', () => {
    expect([...INTAKE_WORKFLOW_STATES]).toEqual([
      'new',
      'open',
      'awaiting_signatures',
      'awaiting_employee',
      'awaiting_external_party',
      'signed',
      'completed',
      'closed',
      'cancelled',
    ]);
  });

  /** Mutation: leave a state out of the label, lane or tone map. */
  it('each carry a label, a lane and a tone', () => {
    for (const s of INTAKE_WORKFLOW_STATES) {
      expect(WORKFLOW_LABEL[s], `${s} has no label`).toBeTruthy();
      expect(WORKFLOW_LANE[s], `${s} has no lane`).toBeTruthy();
      expect(WORKFLOW_TONE[s], `${s} has no tone`).toBeTruthy();
    }
  });
});

describe('the workflow state never lets the legacy column go illegal', () => {
  /**
   * The whole reason this module exists. `firm_matter_intakes.status` has a
   * CHECK constraint over seven values, read live from the database. Anything
   * this module hands the writer has to be one of them or the UPDATE is
   * rejected by Postgres.
   *
   * Mutation: return 'awaiting_signatures' from legacyStatusForWorkflow.
   */
  it('only ever proposes a status the CHECK constraint allows', () => {
    for (const s of INTAKE_WORKFLOW_STATES) {
      for (const current of INTAKE_STATUSES) {
        const res = legacyStatusForWorkflow(s, current);
        if (res.ok && res.status !== null) {
          expect(
            INTAKE_STATUSES,
            `${s} over ${current} proposed ${res.status}, which the CHECK constraint rejects`,
          ).toContain(res.status);
        }
      }
    }
  });

  /**
   * The defect lib/intake-lanes.ts was written to fix, in its new clothes.
   * lib/portal-open-requests.ts calls a request decided when its status is
   * rejected or closed. A ticket the legal team marked Completed that still
   * wrote an open status would sit on the employee's home page forever.
   *
   * Mutation: map 'completed' to 'in_progress'.
   */
  it('writes a decided status for every state that means the firm is finished', () => {
    for (const s of DECIDED_WORKFLOW_STATES) {
      const res = legacyStatusForWorkflow(s, 'in_progress');
      expect(res.ok, `${s} was refused over an open request`).toBe(true);
      if (!res.ok) continue;
      expect(res.status, `${s} left the legacy status alone`).not.toBeNull();
      expect(
        DECIDED_INTAKE_STATUSES,
        `${s} wrote ${res.status}, which the employee's portal still counts as open`,
      ).toContain(res.status as never);
      expect(isIntakeOpen(res.status)).toBe(false);
    }
  });

  /**
   * Mutation: let a live state fall through and write conflict_check_passed
   * over 'converted'. A converted request has a matter behind it and its
   * lifecycle has moved past intake; a note about how the work is going is not
   * a reason to drop it back into the intake queue.
   *
   * Scoped to the LIVE states on purpose. Marking a converted ticket Completed
   * or Cancelled is a real ending and must close it, or the employee is told
   * "Accepted" about a finished piece of work forever.
   */
  it('never lets a live state demote a converted request', () => {
    const live = INTAKE_WORKFLOW_STATES.filter(
      (s) => !DECIDED_WORKFLOW_STATES.includes(s),
    );
    for (const s of live) {
      const res = legacyStatusForWorkflow(s, 'converted');
      expect(res.ok, `${s} was refused on a converted request`).toBe(true);
      if (!res.ok) continue;
      expect(res.status, `${s} overwrote 'converted' with ${res.status}`).toBeNull();
    }
  });

  /**
   * Reopening is reopenIntakeAction's job: it restores the status the request
   * held before the decision and writes the reversal onto the trail. Setting a
   * live state on a decided request from this block would do neither.
   *
   * Mutation: return { ok: true, status: 'in_progress' } instead of refusing.
   */
  it('refuses a live state on a decided request rather than silently reopening it', () => {
    const live = INTAKE_WORKFLOW_STATES.filter(
      (s) => !DECIDED_WORKFLOW_STATES.includes(s),
    );
    for (const s of live) {
      for (const decided of DECIDED_INTAKE_STATUSES) {
        const res = legacyStatusForWorkflow(s, decided);
        expect(res.ok, `${s} was accepted on a ${decided} request`).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/reopen/i);
      }
    }
  });

  /**
   * Mutation: map awaiting_external_party onto a lane it does not reach.
   * A workflow state whose declared lane disagrees with the lane its written
   * status actually lands in is a queue that lies.
   */
  it('lands each state in the lane it claims', () => {
    // Null means "leave the legacy status alone", so the ticket stays in the
    // lane of the status it already had. That is the case this has to cover
    // rather than skip: a state that claims "review" and writes nothing leaves
    // the ticket sitting in "Needs attention" while the screen says otherwise,
    // which is a queue lying about itself in exactly the way that is hardest
    // to notice.
    const before = 'in_progress';
    for (const s of INTAKE_WORKFLOW_STATES) {
      const res = legacyStatusForWorkflow(s, before);
      if (!res.ok) continue;
      const effective = res.status ?? before;
      expect(
        intakeLaneOf(effective),
        `${s} claims the ${WORKFLOW_LANE[s]} lane but leaves the request in ${intakeLaneOf(effective)}`,
      ).toBe(WORKFLOW_LANE[s]);
    }
  });

  /**
   * lib/portal-status.ts says in writing that an unmapped status falls back to
   * "Received", which actively misinforms the requester. Every status this
   * module can write must therefore already be mapped there.
   *
   * Mutation: introduce a new legacy status here without adding it there.
   */
  it('only writes statuses the employee’s portal already has a word for', () => {
    for (const s of INTAKE_WORKFLOW_STATES) {
      const res = legacyStatusForWorkflow(s, 'in_progress');
      if (!res.ok || res.status === null) continue;
      const label = portalStatusLabel(res.status);
      if (DECIDED_WORKFLOW_STATES.includes(s)) {
        expect(label, `${s} reads as "${label}" to the employee`).toBe('Closed');
      } else {
        expect(label).not.toBe('Received');
      }
    }
  });
});

describe('a ticket with no workflow state yet still reads as something', () => {
  /**
   * The column is added by a migration the owner applies. Until then, and for
   * every request filed before it, the value is null and the block must not
   * render blank.
   *
   * Mutation: return 'new' for everything.
   */
  it('derives a state from the legacy status when the column is empty', () => {
    const derived: Record<string, IntakeWorkflowState> = {
      in_progress: 'new',
      conflict_check_passed: 'open',
      conflict_check_flagged: 'open',
      engaged: 'open',
      converted: 'open',
      rejected: 'closed',
      closed: 'closed',
    };
    for (const status of INTAKE_STATUSES) {
      expect(workflowStateOf(null, status)).toBe(derived[status]);
    }
  });

  /** Mutation: ignore the stored column. */
  it('prefers the stored state over the derivation', () => {
    expect(workflowStateOf('awaiting_external_party', 'in_progress')).toBe(
      'awaiting_external_party',
    );
  });

  /** Mutation: trust the column. It is free text as far as this code knows. */
  it('falls back when the stored value is not one of the nine', () => {
    expect(workflowStateOf('escalated', 'in_progress')).toBe('new');
  });

  /**
   * Mutation: derive a decided state from an open status, or an open state
   * from a decided one. The derivation must not move a ticket between lanes.
   */
  it('never derives across the open/decided line', () => {
    for (const status of INTAKE_STATUSES) {
      const decidedStatus = DECIDED_INTAKE_STATUSES.includes(status);
      const decidedState = DECIDED_WORKFLOW_STATES.includes(
        workflowStateOf(null, status),
      );
      expect(decidedState, `${status} derives across the line`).toBe(decidedStatus);
    }
  });
});

describe('what the employee wrote stays in the main column', () => {
  /**
   * The organizing principle, read off the source because no test can see a
   * layout. The aside opens exactly once, so its index splits the page into
   * the two columns and every section is on one side of it.
   *
   * Mutation: move the conflict check back above <aside>.
   */
  it('puts the employee’s own words before the rail and nothing else there', () => {
    const code = codeOf(PAGE);
    const aside = code.indexOf('<aside');
    expect(aside, 'the page has no <aside>').toBeGreaterThan(-1);
    expect([...code.matchAll(/<aside/g)]).toHaveLength(1);

    for (const id of ['matter', 'questions', 'documents']) {
      const at = code.indexOf(`id="${id}"`);
      expect(at, `the ${id} section is missing`).toBeGreaterThan(-1);
      expect(at, `the ${id} section is what the employee brought and belongs in the main column`).toBeLessThan(aside);
    }
  });

  /**
   * Mutation: leave any one of these in the main column. Conflict check,
   * decline or close, analyze and the analysis are things the FIRM does about
   * the request, not things the employee wrote.
   */
  it('puts every firm operation in the rail', () => {
    const code = codeOf(PAGE);
    const aside = code.indexOf('<aside');
    for (const id of ['conflict', 'decide', 'analyze', 'review', 'meeting']) {
      const at = code.indexOf(`id="${id}"`);
      expect(at, `the ${id} section is missing`).toBeGreaterThan(-1);
      expect(at, `${id} is a firm operation and belongs in the rail`).toBeGreaterThan(aside);
    }
  });

  /**
   * Mutation: leave the owner select in the action bar as well as in the
   * management block. A control in two places is two controls that can
   * disagree about what they show.
   */
  it('renders each moved control exactly once', () => {
    const code = codeOf(PAGE);
    expect([...code.matchAll(/<IntakeOwnerSelect/g)]).toHaveLength(0);
    expect([...code.matchAll(/<TicketManagement/g)]).toHaveLength(1);
    expect([...code.matchAll(/<RequestActions/g)]).toHaveLength(1);
  });
});

describe('the accent is spent once', () => {
  /**
   * docs/DESIGN.md: a gold button and a gold heading and a gold rule in the
   * same viewport is three claims on the eye and the reader obeys none of
   * them. This route spent it seven times.
   *
   * The one claim is the action bar's primary, which is the single thing this
   * screen exists to do.
   *
   * Mutation: give any new control btn-primary.
   */
  it('draws one accent-carrying control across the whole route', () => {
    const files = [
      'app/counsel/intake/[id]/page.tsx',
      'app/counsel/intake/[id]/convert-to-matter.tsx',
      'app/counsel/intake/[id]/decide-jump.tsx',
      'app/counsel/intake/[id]/decide-request.tsx',
      'app/counsel/intake/[id]/conflict-check-panel.tsx',
      'app/counsel/intake/[id]/request-actions.tsx',
      'app/counsel/intake/[id]/schedule-meeting.tsx',
      'app/counsel/intake/[id]/ticket-management.tsx',
    ];
    const spend = files.flatMap((f) => {
      const code = codeOf(f);
      return [
        ...[...code.matchAll(/btn-primary/g)].map(() => `${f}: btn-primary`),
        ...[...code.matchAll(/tone="accent"/g)].map(() => `${f}: accent chip`),
        ...[...code.matchAll(/text-accent-text/g)].map(() => `${f}: accent text`),
      ];
    });
    expect(spend, `the accent is claimed ${spend.length} times on one screen`).toEqual([
      'app/counsel/intake/[id]/convert-to-matter.tsx: btn-primary',
    ]);
  });
});

describe('the edge zone decides whether a pointer means "bring the rail back"', () => {
  /**
   * The decision is a pure function so it can be tested at all. It was
   * originally inline in an effect, and every guard on it was pinned only by
   * reading the source, which is how a real defect shipped past twenty-five
   * green tests: `document` fires `pointerleave` continuously at clientX 5,
   * inside the zone, and the cancel wired to it killed every dwell.
   *
   * The browser could not settle it either. Driven through the automation
   * harness the tab reports `visibilityState: 'hidden'` and Chrome freezes its
   * timers, so a 140ms dwell never fires and the feature looks broken whatever
   * the code says. A pure decision has no timers to freeze.
   */
  const at = (x: number, over: Partial<EdgeSample> = {}): EdgeSample => ({
    x,
    buttons: 0,
    hasSelection: false,
    ...over,
  });

  /** Mutation: return 'start' for a first sample already inside the zone. */
  it('will not fire until the pointer has been seen outside the zone', () => {
    // The trap the page-keeper tab documents: the rail can collapse under a
    // stationary pointer that is already at the edge, and a zone that fires on
    // what it sees first springs straight back open.
    expect(edgeRevealDecision(at(2), false).action).toBe('hold');
  });

  /** Mutation: stop arming, and the zone is dead forever. */
  it('arms once the pointer is outside the zone', () => {
    const d = edgeRevealDecision(at(600), false);
    expect(d.armed).toBe(true);
    expect(d.action).toBe('cancel');
  });

  /** Mutation: drop the armed check and it fires on the first edge sample. */
  it('fires once armed and the pointer reaches the edge', () => {
    expect(edgeRevealDecision(at(2), true).action).toBe('start');
    expect(edgeRevealDecision(at(EDGE_ZONE_PX), true).action).toBe('start');
    expect(edgeRevealDecision(at(EDGE_ZONE_PX + 1), true).action).toBe('cancel');
  });

  /**
   * Mutation: drop the buttons check. Dragging a document towards the left of
   * the window would slide the nav out from under the drag.
   */
  it('refuses while a button is held', () => {
    expect(edgeRevealDecision(at(2, { buttons: 1 }), true).action).toBe('cancel');
  });

  /**
   * Mutation: drop the selection check. Sweeping a selection leftwards through
   * the matter summary ends past the edge of the text, and the selection is
   * live at that moment even between drags.
   */
  it('refuses while text is selected', () => {
    expect(edgeRevealDecision(at(2, { hasSelection: true }), true).action).toBe(
      'cancel',
    );
  });

  /** Mutation: disarm on an edge sample, and a second dwell can never start. */
  it('stays armed while the pointer rests at the edge', () => {
    expect(edgeRevealDecision(at(2), true).armed).toBe(true);
    expect(edgeRevealDecision(at(2, { buttons: 1 }), true).armed).toBe(true);
  });
});

describe('the left rail collapses on this route and comes back', () => {
  /**
   * Mutation: delete the mount. Without it the route never collapses the rail
   * and the ticket never gets the width.
   */
  it('asks for focus mode on entry', () => {
    const code = codeOf(PAGE);
    expect(code).toMatch(/<RequestSidebarFocus\s*\/>/);
  });

  /**
   * Hover is an accelerator, never the only way in. A touch user cannot aim at
   * a screen edge and a keyboard user has no pointer at all, so the tab stays
   * a real button and the edge trigger only arms for a mouse.
   *
   * Mutation: drop the pointer media query and the edge fires on a phone.
   */
  it('only arms the edge trigger for a pointer that can aim at an edge', () => {
    const code = codeOf(SIDEBAR);
    expect(code).toContain('(hover: hover) and (pointer: fine)');
  });

  /**
   * The component supplies the two facts the decision cannot read for itself.
   * The rules on them are tested directly, above.
   *
   * Mutation: hardcode `buttons: 0` or `hasSelection: false` and every guard
   * above still passes while the real thing opens under a drag.
   */
  it('reports the live button and selection state to the decision', () => {
    const code = codeOf(SIDEBAR);
    expect(code, 'the drag state is not read from the event').toMatch(
      /buttons:\s*e\.buttons/,
    );
    expect(code, 'the selection state is not read from the document').toMatch(
      /hasSelection:\s*selecting\(\)/,
    );
    expect(code).toContain('getSelection');
  });

  /**
   * The existing tab documents why it does NOT expand on hover: it renders
   * where the cursor just was, so a hover handler fired on the first frame and
   * the rail sprang straight back open. An edge zone has the same failure
   * unless the pointer has to leave it once before it can fire again.
   *
   * Mutation: drop the arming and the rail reopens the instant it is closed
   * if the cursor happens to be near the edge.
   */
  it('reveals only through the dwell timer, and defers every rule to one place', () => {
    const code = codeOf(SIDEBAR);

    // The reveal has to be REACHED through the timer. Checking merely that the
    // names appear passed a mutation that called onReveal() directly and left
    // the declarations sitting above it.
    expect(
      [...code.matchAll(/onReveal\(\)/g)],
      'the reveal is called from somewhere other than the dwell timer',
    ).toHaveLength(1);
    const timer = code.indexOf('setTimeout(');
    const call = code.indexOf('onReveal()');
    const dwell = code.indexOf('EDGE_DWELL_MS)');
    expect(timer, 'there is no dwell timer').toBeGreaterThan(-1);
    expect(call, 'the reveal fires before the dwell timer').toBeGreaterThan(timer);
    expect(call, 'the reveal is not inside the dwell timer').toBeLessThan(dwell);

    // And the rules are not re-implemented here. A second copy of "is it
    // armed, is a button down" beside the tested one is the drift this repo
    // keeps paying for.
    expect(code, 'the decision is not delegated').toContain('edgeRevealDecision(');
    expect(code, 'the arming rule has been re-inlined here').not.toMatch(
      /armed\s*=\s*true/,
    );
  });

  /**
   * docs/DESIGN.md: everything drops out under prefers-reduced-motion. Not
   * reduced. Out.
   *
   * Mutation: delete the class and the rail slides for a reader who asked for
   * no movement.
   */
  it('drops the slide under prefers-reduced-motion', () => {
    const code = codeOf(SIDEBAR);
    expect(code).toContain('motion-reduce:transition-none');
  });

  /**
   * The defect that only rendering the page found, pinned so it cannot come
   * back. `document` fires `pointerleave` continuously at clientX 5 under this
   * shell, which is INSIDE the 6px zone, so a cancel wired to it killed every
   * dwell on the frame it started. The reveal fired once, by a race, and never
   * again, with the whole suite green.
   *
   * Mutation: put the pointerleave listener back.
   */
  it('does not cancel the dwell on an event the edge itself fires', () => {
    const code = codeOf(SIDEBAR);
    expect(code, 'a document-level leave cancels the dwell from inside the zone').not.toMatch(
      /addEventListener\(\s*'pointer(leave|out)'/,
    );
    expect(code, 'nothing drops a pending timer when the window goes away').toMatch(
      /addEventListener\('blur'/,
    );
  });

  /**
   * Mutation: render the trigger unconditionally. An edge zone over an already
   * open rail is a listener that can only misfire.
   */
  it('mounts the edge trigger only while the rail is collapsed', () => {
    const code = codeOf(SIDEBAR);
    expect(code).toMatch(/collapsed && \(?\s*<SidebarEdgeReveal/);
  });
});

describe('every write is gated on the server', () => {
  /**
   * Every export of a 'use server' module is a public HTTP endpoint callable
   * with arguments of the caller's choosing, and this one writes through the
   * service-role client, which bypasses RLS entirely. A select of valid
   * options is not a gate.
   *
   * Mutation: drop the role check, or the active-firm gate, or the
   * .select('id') that separates "wrote a row" from "matched nothing".
   */
  it('checks the role, the access state and the row it claims to have written', () => {
    const code = codeOf('lib/firm-actions.ts');
    const at = code.indexOf('export async function setIntakeWorkflowAction');
    expect(at, 'setIntakeWorkflowAction is missing').toBeGreaterThan(-1);
    const body = code.slice(at, code.indexOf('\nexport ', at + 1));
    expect(body, 'no role gate').toMatch(/callerHasFirmRole\(firmId, FIRM_MANAGE_ROLES\)/);
    expect(body, 'no active-firm gate').toContain('await requireActiveFirm(firmId)');
    expect(body, 'the write is not confirmed').toMatch(/\.select\('id'\)/);
    expect(body, 'the write is not scoped to the firm the caller was authorized for').toMatch(
      /\.eq\('firm_id', firmId\)/,
    );
  });
});

describe('the migration is written and not assumed', () => {
  /**
   * Applying migrations and regenerating supabase/schema-fingerprint.sha256
   * are the owner's steps, and a CI gate fails while the fingerprint is stale.
   * What this can check is that the migration says what the code believes.
   *
   * Mutation: add a tenth state to the code without adding it to the CHECK.
   */
  it('constrains the column to exactly the states the code can write', () => {
    const sql = stripSql(read('supabase/migrations/20260816_intake_workflow_state.sql'));
    for (const s of INTAKE_WORKFLOW_STATES) {
      expect(sql, `${s} is missing from the CHECK constraint`).toContain(`'${s}'`);
    }
    expect(sql).toContain('workflow_state');
    expect(sql).toContain('follow_up_on');
    expect(sql).toContain('due_on');
  });

  /**
   * The reminder already exists in intake_answers.reminder_at, is written by
   * setIntakeReminderAction and is swept by the deadlines cron. A second one
   * would be a second answer to the same question.
   *
   * Mutation: add a reminder column.
   */
  it('does not add a second reminder', () => {
    const sql = stripSql(read('supabase/migrations/20260816_intake_workflow_state.sql'));
    expect(sql.toLowerCase()).not.toContain('reminder');
  });
});
