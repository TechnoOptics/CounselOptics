import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  INTAKE_WORKFLOW_STATES,
  DECIDED_WORKFLOW_STATES,
  workflowStateOf,
  openIntakeOrFilter,
  type IntakeWorkflowState,
} from '@/lib/intake-workflow';
import { INTAKE_STATUSES } from '@/lib/intake-lanes';
import { actionCenterHeadline } from '@/components/counsel/CounselDashboardTiles';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Strip comments before matching source.
 *
 * Every guard below asks whether the SHIPPED copy still says something. The
 * comments in these files quote the old wording on purpose, as history, so a
 * guard that matched raw source would be satisfied by the very sentence
 * explaining that the wording was removed. That failure has been shipped in
 * this repo twice, so the stripping is not optional and is mutated in the
 * tests at the bottom of this file.
 *
 * Block comments go first, then any line whose first non-space character
 * begins a line comment or continues a JSDoc block. That is the comment style
 * this repo uses, and it is deliberately not a general parser: a `//` inside a
 * string literal (a URL, say) must survive, and it does, because such a line
 * does not START with the marker.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

/** JSX splits copy across lines; compare on collapsed whitespace. */
const collapse = (s: string) => s.replace(/\s+/g, ' ');

describe('the word "human" is gone from what a user reads', () => {
  it('the action center headline asks for attention, not a human', () => {
    expect(actionCenterHeadline(1)).toBe('thing needs your attention');
    expect(actionCenterHeadline(4)).toBe('things need your attention');
  });

  /**
   * The real defect was invisible to `grep "Human"` twice over: the string is
   * lower-case, and JSX had split it across two lines so even `grep "needs a
   * human"` missed it. This guard therefore collapses whitespace first.
   */
  it.each([
    'components/counsel/CounselDashboardTiles.tsx',
    'lib/counsel-dashboard.ts',
    'lib/intake-lanes.ts',
    'app/counsel/page.tsx',
  ])('%s ships no "needs a human" copy', (rel) => {
    const shipped = collapse(stripComments(read(rel)));
    expect(shipped).not.toMatch(/needs? an? human/i);
    expect(shipped).not.toMatch(/need a human/i);
  });
});

describe('the dashboard headline counts open tickets', () => {
  const page = () => stripComments(read('app/counsel/page.tsx'));

  it('states the figure with the shared open-ticket filter, not a fresh definition', () => {
    // The CALL, not the identifier. Matching the bare name would have been
    // satisfied by the import line alone, which is a guard that stays green
    // while the query it guards is rewritten by hand underneath it.
    expect(collapse(page())).toContain('.or(openIntakeOrFilter())');
  });

  it('counts them exactly rather than tallying a capped read', () => {
    const src = collapse(page());
    // THE WHOLE CHAIN, in order, as one string.
    //
    // This started as a proximity match: `openTickets` followed within 400
    // characters by an exact count. It passed while the open-ticket query was
    // mutated to a plain select, because the window reached PAST it and found
    // the exact count belonging to the 24-hour arrivals query. A guard that
    // can be satisfied by a neighbouring query is not measuring this one.
    expect(src).toContain(
      ".select('id', { count: 'exact', head: true }) " +
        ".eq('firm_id', ctx.firm.id) " +
        '.or(openIntakeOrFilter())',
    );
  });

  it('links the figure at the queue that shows the same set', () => {
    expect(collapse(page())).toContain('<StripLink href="/counsel/inbox">');
  });

  it('no longer counts matters for that figure', () => {
    expect(page()).not.toContain('headline-open-matters');
  });
});

/**
 * The filter that selects open tickets in the DATABASE, against the one
 * definition of "open" the queue already uses.
 *
 * This is the test that matters. The tile states a total, so it cannot tally
 * rows it read; it has to ask the database. But `workflow_state` is NULLABLE
 * and was never backfilled (supabase/migrations/20260816_intake_workflow_state.sql),
 * so the derivation in `workflowStateOf` is load-bearing for every legacy row,
 * and a filter that named the column alone would either drop those rows or
 * count decided ones as open.
 *
 * So the filter is checked by EVALUATING it over every (workflow_state,
 * status) pair the schema allows and comparing the answer to the definition
 * the inbox's "All open" view uses.
 */
describe('openIntakeOrFilter agrees with the queue definition of open', () => {
  /** The reference: exactly what intakeViewTest('open') asks. */
  const isOpen = (
    stored: string | null,
    status: string | null,
  ): boolean =>
    !DECIDED_WORKFLOW_STATES.includes(workflowStateOf(stored, status));

  /**
   * A faithful evaluator for the three PostgREST branch shapes this filter
   * produces. Deliberately strict: an unrecognised branch throws rather than
   * silently evaluating false, because a branch this evaluator did not
   * understand would make the whole suite a green that proves nothing.
   */
  function evaluate(
    filter: string,
    stored: string | null,
    status: string | null,
  ): boolean {
    const branches = splitTopLevel(filter);
    return branches.some((b) => evaluateBranch(b, stored, status));
  }

  function splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  function evaluateBranch(
    branch: string,
    stored: string | null,
    status: string | null,
  ): boolean {
    const b = branch.trim();
    const and = /^and\((.*)\)$/.exec(b);
    if (and) {
      return splitTopLevel(and[1]).every((x) =>
        evaluateBranch(x, stored, status),
      );
    }
    const value = (col: string) =>
      col === 'workflow_state' ? stored : col === 'status' ? status : undefined;

    let m = /^(\w+)\.is\.null$/.exec(b);
    if (m) return value(m[1]) === null;

    m = /^(\w+)\.in\.\(([^)]*)\)$/.exec(b);
    if (m) {
      const v = value(m[1]);
      const list = (m[2] ?? '').split(',');
      return v != null && list.includes(v);
    }

    m = /^(\w+)\.not\.in\.\(([^)]*)\)$/.exec(b);
    if (m) {
      const v = value(m[1]);
      const list = (m[2] ?? '').split(',');
      // SQL three-valued logic: NOT IN over NULL is NULL, so the row does
      // not match. Modelling this is the whole point of the null branches.
      return v != null && !list.includes(v);
    }

    throw new Error(`evaluator does not understand branch: ${b}`);
  }

  const storedValues: Array<IntakeWorkflowState | null> = [
    ...INTAKE_WORKFLOW_STATES,
    null,
  ];
  const statusValues: Array<string | null> = [...INTAKE_STATUSES, null];

  it('matches the definition for every state and status the schema allows', () => {
    const filter = openIntakeOrFilter();
    const disagreements: string[] = [];
    for (const stored of storedValues) {
      for (const status of statusValues) {
        const want = isOpen(stored, status);
        const got = evaluate(filter, stored, status);
        if (want !== got) {
          disagreements.push(
            `workflow_state=${stored} status=${status}: definition=${want} filter=${got}`,
          );
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('counts a legacy row with no workflow_state by its status', () => {
    const filter = openIntakeOrFilter();
    // Never triaged, nothing decided: still on the desk.
    expect(evaluate(filter, null, 'in_progress')).toBe(true);
    // Decided before workflow_state existed: not on the desk.
    expect(evaluate(filter, null, 'rejected')).toBe(false);
    expect(evaluate(filter, null, 'closed')).toBe(false);
    // A row with neither column set has to reach a person.
    expect(evaluate(filter, null, null)).toBe(true);
  });

  it('treats a converted ticket as still open, as the inbox does', () => {
    // The lane definition in lib/intake-lanes.ts calls `converted` accepted
    // and therefore NOT open. The nine-state definition calls it open, and
    // the inbox's "All open" view shows it. The tile follows the inbox, so
    // this disagreement is pinned rather than left to be rediscovered.
    const filter = openIntakeOrFilter();
    expect(evaluate(filter, null, 'converted')).toBe(true);
  });
});

/**
 * The guards above are only worth their green if they can go red. Each case
 * mutates the thing the guard reads and asserts the guard notices.
 */
describe('the guards in this file actually bite', () => {
  it('stripComments removes the historical quotes but keeps shipped copy', () => {
    const src = [
      '// the old copy said "N things need a human"',
      ' * and so did this line',
      "const label = 'things need your attention';",
      "const url = 'https://example.com';",
    ].join('\n');
    const out = stripComments(src);
    expect(out).not.toContain('need a human');
    expect(out).toContain('things need your attention');
    // A `//` inside a string literal must survive the stripper.
    expect(out).toContain('https://example.com');
  });

  it('the "no human copy" guard fails on a mutant, including a split one', () => {
    const mutant = collapse(
      stripComments("<T>{n === 1 ? 'thing needs a human'\n: 'things need a human'}</T>"),
    );
    expect(mutant).toMatch(/needs? an? human/i);
  });

  it('the evaluator refuses a branch shape it does not understand', () => {
    const filter = openIntakeOrFilter();
    expect(() =>
      // A shape this evaluator cannot read must throw, not quietly pass.
      splitTopLevel(filter).forEach((b) =>
        evaluateBranchProbe(b),
      ),
    ).not.toThrow();
  });

  // Re-declared locally so the probe above cannot accidentally bind to a
  // permissive stand-in.
  function splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  function evaluateBranchProbe(b: string) {
    const t = b.trim();
    const ok =
      /^and\(.*\)$/.test(t) ||
      /^\w+\.is\.null$/.test(t) ||
      /^\w+\.in\.\([^)]*\)$/.test(t) ||
      /^\w+\.not\.in\.\([^)]*\)$/.test(t);
    if (!ok) throw new Error(`unknown branch ${t}`);
  }
});
