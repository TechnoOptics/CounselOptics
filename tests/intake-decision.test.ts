import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Making a legal request closable, and the four ways that could have been
 * done wrongly.
 *
 * `firm_matter_intakes.status` allowed seven values and only two were ever
 * written. `engaged`, `rejected` and `closed` were declared in the CHECK
 * constraint, mapped into lanes, coloured and counted, and unreachable. The
 * cost fell on the employee: lib/portal-open-requests.ts calls a request
 * decided when it is `rejected` or `closed`, so with no writer for either,
 * "You have N requests open with your legal team" could only ever grow.
 *
 * Each describe below pins one property, and each names the mutation that
 * turns it red. Anchors on source text strip comments first, because four
 * guards in this repo have been found passing while the thing they guarded
 * was gone, satisfied by a comment or a neighbouring string.
 */

type Scenario = {
  /** Rows the fake reports the UPDATE as having affected. */
  written: Array<{ id: string }>;
  /** Did the code ask the database which rows it wrote? */
  selected: boolean;
  /** What callerHasFirmRole answers. */
  authorized: boolean;
  /** The row the action reads before it writes. */
  status: string;
  answers: Record<string, unknown>;
  /** Whether the trail insert succeeds. */
  trailOk: boolean;
  /** The update payload the fake last received. */
  payload: Record<string, unknown> | null;
  /** Ordered log of what the action did. */
  calls: string[];
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = {
    current: {
      written: [{ id: 'intake-1' }],
      selected: false,
      authorized: true,
      status: 'conflict_check_passed',
      answers: {},
      trailOk: true,
      payload: null,
      calls: [],
    },
  };

  /**
   * A postgrest-js shaped fake, faithful on the one point that matters: the
   * builder returned by `.eq()` is itself awaitable AND carries `.select()`.
   * That is why the defect this file exists for compiles and runs. Awaiting
   * without selecting resolves clean with nothing to inspect, exactly as the
   * real client does, so deleting the `.select('id')` fails the assertions
   * rather than the harness.
   */
  function makeAdmin() {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 'intake-1',
                firm_id: 'firm-1',
                created_by: 'employee-1',
                client_name: 'Dana Ruiz',
                client_email: null,
                matter_type: 'nda',
                status: s.current.status,
                assigned_to: null,
                intake_answers: s.current.answers,
              },
              error: null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          s.current.payload = payload;
          const node: Record<string, unknown> = {
            eq: () => node,
            select: () => {
              s.current.selected = true;
              s.current.calls.push('write');
              return Promise.resolve({ data: s.current.written, error: null });
            },
            then: (resolve: (v: unknown) => unknown) => {
              s.current.calls.push('write');
              return resolve({ data: null, error: null });
            },
          };
          return node;
        },
      }),
    };
  }

  return { s, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'lawyer-1', email: 'a@example.com' }),
  createServerSupabase: () => ({}),
  requireUser: async () => ({ id: 'lawyer-1' }),
}));

vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerHasFirmRole: async () => h.s.current.authorized,
  callerIsFirmMember: async () => h.s.current.authorized,
  requireActiveFirm: async () => {},
}));

vi.mock('../lib/intake-notify', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hydratePeople: async () =>
    new Map([['lawyer-1', { userId: 'lawyer-1', name: 'Ana Vasquez', avatarUrl: null, side: 'legal' }]]),
  insertIntakeMessage: async (input: { eventType?: string | null }) => {
    h.s.current.calls.push(`trail:${input.eventType}`);
    return h.s.current.trailOk ? { id: 'msg-1', mentions: [] } : null;
  },
  revalidateIntake: () => {},
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// lib/portal-open-requests wraps its loader in React's per-request memo, which
// the node test environment has no server dispatcher for. Only `isOpenStatus`
// is under test here and it is a pure predicate; the memo is passed through.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cache: (fn: unknown) => fn,
}));

const { decideIntakeAction, reopenIntakeAction } = await import('../lib/firm-actions');
const {
  INTAKE_DECISIONS,
  DECIDED_INTAKE_STATUSES,
  reopenedIntakeStatus,
} = await import('../lib/intake-lanes');
const { isOpenStatus } = await import('../lib/portal-open-requests');

const reset = () => {
  h.s.current = {
    written: [{ id: 'intake-1' }],
    selected: false,
    authorized: true,
    status: 'conflict_check_passed',
    answers: {},
    trailOk: true,
    payload: null,
    calls: [],
  };
};

beforeEach(reset);

/* ------------------------------------------------------------------ */
/* 1. The authorization is in the action, not in what renders.          */
/* ------------------------------------------------------------------ */

/**
 * Mutation: delete the `callerHasFirmRole` guard from decideIntakeAction (or
 * widen FIRM_MANAGE_ROLES to any member). Both tests here go red, because a
 * refused caller would then reach the write.
 */
describe('a caller who is not on the firm is refused by the action itself', () => {
  it('refuses to decide, and writes nothing', async () => {
    h.s.current.authorized = false;
    const res = await decideIntakeAction('firm-1', 'intake-1', 'declined', 'Out of scope.');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/owners, admins or attorneys/i);
    expect(h.s.current.calls).toEqual([]);
    expect(h.s.current.payload).toBeNull();
  });

  it('refuses to reopen, and writes nothing', async () => {
    h.s.current.authorized = false;
    h.s.current.status = 'rejected';
    const res = await reopenIntakeAction('firm-1', 'intake-1');
    expect(res.ok).toBe(false);
    expect(h.s.current.calls).toEqual([]);
    expect(h.s.current.payload).toBeNull();
  });

  it('returns the refusal rather than throwing it', async () => {
    h.s.current.authorized = false;
    await expect(
      decideIntakeAction('firm-1', 'intake-1', 'declined', 'Out of scope.'),
    ).resolves.toMatchObject({ ok: false });
  });

  it('refuses a request that belongs to another firm', async () => {
    const res = await decideIntakeAction('firm-2', 'intake-1', 'declined', 'Out of scope.');
    expect(res.ok).toBe(false);
    expect(h.s.current.payload).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 2. A write that matched no row is a failure the user sees.           */
/* ------------------------------------------------------------------ */

/**
 * Two assertions, deliberately separate. Removing only the `.select('id')`
 * would leave `written` undefined and still take the zero-row branch, so a
 * single "it refuses" test would stay green for the wrong reason and the
 * guard would quietly become an accident.
 *
 * Mutations:
 *   - delete `.select('id')` from the update -> "asks the database which rows
 *     it wrote" goes red.
 *   - delete the `written.length === 0` branch -> "refuses, and records
 *     nothing, when the update matched no row" goes red.
 */
describe('a decision that did not write a row is not reported as one', () => {
  it('asks the database which rows it wrote', async () => {
    await decideIntakeAction('firm-1', 'intake-1', 'declined', 'Out of scope.');
    expect(h.s.current.selected).toBe(true);
  });

  it('refuses, and records nothing, when the update matched no row', async () => {
    h.s.current.written = [];
    const res = await decideIntakeAction('firm-1', 'intake-1', 'declined', 'Out of scope.');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Nothing on the request has changed/i);
    // The whole point: no trail entry for a decision that did not happen.
    expect(h.s.current.calls).toEqual(['write']);
  });

  it('reopen asks too, and refuses a write that matched no row', async () => {
    h.s.current.status = 'closed';
    h.s.current.written = [];
    const res = await reopenIntakeAction('firm-1', 'intake-1');
    expect(res.ok).toBe(false);
    expect(h.s.current.selected).toBe(true);
    expect(h.s.current.calls).toEqual(['write']);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The record of the decision is checked, and ordered after it.      */
/* ------------------------------------------------------------------ */

/**
 * Mutations:
 *   - drop the `if (!message)` check in recordIntakeDecisionEvent and always
 *     return true -> "says so when the trail entry did not go in" goes red.
 *   - move the recordIntakeDecisionEvent call above the update -> "records
 *     the decision only after the row is written" goes red.
 */
describe('the decision is recorded the way this product records decisions', () => {
  it('records the decision only after the row is written', async () => {
    const res = await decideIntakeAction('firm-1', 'intake-1', 'declined', 'Out of scope.');
    expect(res.ok).toBe(true);
    expect(h.s.current.calls).toEqual(['write', 'trail:decision_recorded']);
  });

  it('puts the reason on the trail the requester can read', async () => {
    const bodies: string[] = [];
    const notify = await import('../lib/intake-notify');
    const spy = vi
      .spyOn(notify, 'insertIntakeMessage')
      .mockImplementation(async (input: { body: string; visibility: string; authorRole: string }) => {
        bodies.push(`${input.authorRole}|${input.visibility}|${input.body}`);
        return { id: 'msg-1', mentions: [] } as never;
      });
    await decideIntakeAction('firm-1', 'intake-1', 'declined', 'Conflict with an existing client.');
    spy.mockRestore();
    expect(bodies).toHaveLength(1);
    // 'shared' or the requester never sees it; 'legal' or notifyIntakeActivity
    // routes it to the legal team instead of to the person it is about.
    expect(bodies[0]).toMatch(/^legal\|shared\|/);
    expect(bodies[0]).toContain('Conflict with an existing client.');
  });

  it('says so when the trail entry did not go in, rather than reporting a clean save', async () => {
    h.s.current.trailOk = false;
    const res = await decideIntakeAction('firm-1', 'intake-1', 'declined', 'Out of scope.');
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/could not be added to the request trail/i);
  });

  it('reports no warning when the trail entry went in', async () => {
    const res = await decideIntakeAction('firm-1', 'intake-1', 'closed_out', '');
    expect(res).toEqual({ ok: true });
  });
});

/* ------------------------------------------------------------------ */
/* 4. THE PROPERTY THIS FIX IS FOR: the employee's count goes down.     */
/* ------------------------------------------------------------------ */

/**
 * The user-visible property, and the one most likely to be left broken by a
 * fix that only writes a column. app/portal/page.tsx builds "You have N
 * requests open" from `rows.filter(isOpenStatus)`, so what matters is not
 * that a status was written but that the status written is one the portal
 * stops counting.
 *
 * Mutation: change either value in INTAKE_DECISIONS to 'engaged' (or to
 * 'in_progress'). Every test in this block goes red.
 */
describe("a decided request stops counting against the employee", () => {
  for (const [outcome, expected] of Object.entries(INTAKE_DECISIONS)) {
    it(`${outcome} takes the open count from 1 to 0`, async () => {
      const before = [{ id: 'intake-1', status: h.s.current.status }];
      expect(before.filter((r) => isOpenStatus(r.status))).toHaveLength(1);

      const res = await decideIntakeAction('firm-1', 'intake-1', outcome, 'A reason.');
      expect(res.ok).toBe(true);

      const status = String(h.s.current.payload?.status ?? '');
      expect(status).toBe(expected);
      const after = before.map((r) => ({ ...r, status }));
      expect(after.filter((r) => isOpenStatus(r.status))).toHaveLength(0);
    });
  }

  it('every outcome the control offers writes a status the portal calls decided', () => {
    for (const status of Object.values(INTAKE_DECISIONS)) {
      expect(DECIDED_INTAKE_STATUSES).toContain(status);
      expect(isOpenStatus(status)).toBe(false);
    }
  });

  it('reopening puts it back in the count', async () => {
    h.s.current.status = 'rejected';
    h.s.current.answers = {
      decision: { outcome: 'declined', previousStatus: 'conflict_check_passed' },
    };
    const res = await reopenIntakeAction('firm-1', 'intake-1');
    expect(res.ok).toBe(true);
    const status = String(h.s.current.payload?.status ?? '');
    expect(status).toBe('conflict_check_passed');
    expect(isOpenStatus(status)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 5. The decision carries a reason, and can be undone.                 */
/* ------------------------------------------------------------------ */

describe('the decision the firm records', () => {
  it('will not decline without a reason, and writes nothing when it refuses', async () => {
    const res = await decideIntakeAction('firm-1', 'intake-1', 'declined', '   ');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reason/i);
    expect(h.s.current.calls).toEqual([]);
  });

  it('allows a close-out without one, since "you withdrew it" needs no essay', async () => {
    const res = await decideIntakeAction('firm-1', 'intake-1', 'closed_out', '');
    expect(res.ok).toBe(true);
  });

  it('refuses an outcome that is not one the product has', async () => {
    const res = await decideIntakeAction('firm-1', 'intake-1', 'engaged', 'x');
    expect(res.ok).toBe(false);
    expect(h.s.current.calls).toEqual([]);
  });

  it('stores who decided, when, why, and what to restore', async () => {
    await decideIntakeAction('firm-1', 'intake-1', 'declined', 'Conflict of interest.');
    const answers = h.s.current.payload?.intake_answers as Record<string, unknown>;
    expect(answers.decision).toMatchObject({
      outcome: 'declined',
      reason: 'Conflict of interest.',
      byUserId: 'lawyer-1',
      byName: 'Ana Vasquez',
      previousStatus: 'conflict_check_passed',
    });
  });

  it('clears the decision when the request is reopened', async () => {
    h.s.current.status = 'closed';
    h.s.current.answers = {
      folder: 'contracts',
      decision: { outcome: 'closed_out', previousStatus: 'in_progress' },
    };
    const res = await reopenIntakeAction('firm-1', 'intake-1');
    expect(res.ok).toBe(true);
    const answers = h.s.current.payload?.intake_answers as Record<string, unknown>;
    expect(answers.decision).toBeUndefined();
    // Everything else on the request survives the round trip.
    expect(answers.folder).toBe('contracts');
  });

  it('refuses to reopen a request that is already open', async () => {
    h.s.current.status = 'in_progress';
    const res = await reopenIntakeAction('firm-1', 'intake-1');
    expect(res.ok).toBe(false);
    expect(h.s.current.calls).toEqual([]);
  });

  it('sends an unplaceable previous status back to the queue, not to a dead lane', () => {
    expect(reopenedIntakeStatus('conflict_check_flagged')).toBe('conflict_check_flagged');
    expect(reopenedIntakeStatus(undefined)).toBe('in_progress');
    expect(reopenedIntakeStatus('nonsense')).toBe('in_progress');
    // A stored 'rejected' would reopen into the closed lane, which is not a reopen.
    expect(reopenedIntakeStatus('rejected')).toBe('in_progress');
  });
});

/* ------------------------------------------------------------------ */
/* 6. The control is wired to the writer, not drawn in front of it.     */
/* ------------------------------------------------------------------ */

/**
 * docs/PARITY-PAGE-RULES.md: do not add a control with nothing behind it.
 * This repo has shipped a "Revoked" badge with no revoke action.
 *
 * Anchored on the call form and its arguments, with comments stripped first,
 * so a mention of the action in prose cannot satisfy it.
 *
 * Mutations: delete either call from decide-request.tsx, or unmount
 * <DecideRequest> from the page. The matching test goes red.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the decision control calls the writer', () => {
  const panel = () => stripComments(read('../app/counsel/intake/[id]/decide-request.tsx'));

  it('passes the outcome and the reason to decideIntakeAction', () => {
    expect(panel()).toMatch(
      /decideIntakeAction\(\s*firmId\s*,\s*intakeId\s*,\s*outcome\s*,\s*reason\s*,?\s*\)/,
    );
  });

  it('offers both outcomes the product has, and only those', () => {
    const code = panel();
    expect(code).toMatch(/decide\('declined'\)/);
    expect(code).toMatch(/decide\('closed_out'\)/);
    expect(code).not.toMatch(/decide\('engaged'\)/);
  });

  it('offers the way back', () => {
    expect(panel()).toMatch(/reopenIntakeAction\(\s*firmId\s*,\s*intakeId\s*,?\s*\)/);
  });

  it('goes through runGatedAction, so a lapsed organization gets calm copy', () => {
    const code = panel();
    expect(code).toMatch(/runGatedAction\(\s*\(\)\s*=>\s*decideIntakeAction\(/);
    expect(code).toMatch(/runGatedAction\(\s*\(\)\s*=>\s*reopenIntakeAction\(/);
  });

  it('is mounted on the request page with the stored decision', () => {
    const page = stripComments(read('../app/counsel/intake/[id]/page.tsx'));
    // The action bar's secondary needs to know whether a decision exists,
    // so the page hoists the read into a const and both use it. Either
    // spelling is fine; what is NOT fine is mounting the panel with null,
    // which is what this has always been here to catch, so the name form
    // is only accepted when that name is bound to the reader.
    expect(page).toMatch(
      /<DecideRequest[\s\S]{0,240}?decision=\{(?:readDecision\(ans\)|decision)\}[\s\S]{0,80}?\/>/,
    );
    if (/decision=\{decision\}/.test(page)) {
      expect(page).toMatch(/const decision = readDecision\(ans\);/);
    }
  });

  it("shows the employee the reason on their own copy of the request", () => {
    const portal = stripComments(read('../app/portal/[id]/page.tsx'));
    expect(portal).toMatch(/\{decision\s*&&\s*\(/);
    expect(portal).toMatch(/\{decision\.reason\}/);
  });
});
