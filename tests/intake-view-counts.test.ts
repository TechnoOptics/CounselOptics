/**
 * The request queue states no figure it has not counted, and speaks no word
 * the product does not have.
 *
 * Two families meet on this surface.
 *
 * COUNTS ARE COUNTS. Four surfaces in this repo have shipped a total tallied
 * over a capped read: the dashboard lanes, the approvals queue, the matters
 * strip and the matter view counts. The list this replaces was the fifth. It
 * read 200 rows and then printed `byLane(l).length` as the size of a lane and
 * `openInternal` as the size of a queue, so a firm past its 200th request read
 * a floor with a lane heading over it.
 *
 * TAKE THE STRUCTURE, NOT THE VOCABULARY. The layout is modelled on an IT
 * service desk. P1/P2, VIP, SLA at risk and Escalations are its language and
 * none of the four has a fact behind it here: there is no client tier, no
 * promised-by date and no escalation state. A red "Breached" over a column the
 * data cannot fill is the screen lying, so the words are kept out by a check
 * rather than by good intentions.
 *
 * Every source anchor strips comments first, because a comment explaining a
 * fix contains the string a guard searches for and this repo has found five
 * guards passing over prose.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { INTAKE_LIST_VIEW_KEYS } from '@/lib/intake-list';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

const codeOf = (rel: string) => stripComments(read(rel));

const PAGE = 'app/counsel/inbox/page.tsx';
const TABLE = 'app/counsel/inbox/requests-table.tsx';

/** Each `.from('firm_matter_intakes')` call and the query chained onto it. */
function intakeQueries(src: string): string[] {
  return src
    .split("from('firm_matter_intakes')")
    .slice(1)
    // A query chain ends at the first blank line after it; a fixed window
    // would run one query's text into the next one's.
    .map((part) => part.split(/\n\s*\n/)[0]);
}

describe('the request queue reads rows once and counts separately', () => {
  const page = codeOf(PAGE);
  const queries = intakeQueries(page);

  it('finds the intake reads at all, so an empty sweep cannot pass', () => {
    // Two sites: the bounded read of the rows the table draws, and the
    // uncapped exact count of what the firm actually has.
    expect(queries).toHaveLength(2);
  });

  it('bounds exactly the one read that is a list rather than a total', () => {
    const bounded = queries.filter((q) => q.includes('.limit('));
    expect(bounded).toHaveLength(1);
    expect(bounded[0], 'the bounded read is not the one that draws rows').toContain(
      'intake_answers',
    );
    expect(bounded[0]).toContain('INTAKE_LIST_READ_LIMIT');
  });

  it('asks the database for the figure it states as the firm total', () => {
    const totals = queries.filter((q) => !q.includes('.limit('));
    expect(totals).toHaveLength(1);
    expect(totals[0], 'the total is not an exact count').toContain("count: 'exact'");
    expect(totals[0], 'the total read drags rows back with it').toContain(
      'head: true',
    );
  });

  it('says how far the rows it loaded actually reach', () => {
    // A bounded read is honest only if the boundary is STATED. Merely
    // computing it is not enough: the first version of this checked that the
    // page mentioned `loadedAll` somewhere, which a page that worked it out
    // and then never rendered it would pass.
    expect(page).toMatch(/loadedAll\s*=/);
    expect(codeOf(TABLE), 'the boundary is computed and never shown').toMatch(
      /!loadedAll\s*&&/,
    );
  });
});

describe('every tab states the size of the list that tab would render', () => {
  const table = codeOf(TABLE);

  it('builds the strip from intakeViewCounts, not from its own filter', () => {
    // The CALL, not the import. Naming the module while tallying the rows by
    // hand underneath is exactly the shape this is written against, and an
    // import survives that mutation untouched.
    expect(table).toMatch(/counts\s*=\s*intakeViewCounts\(/);
    // Tolerant of an arrow predicate with parens in it. `[^)]*` stopped at the
    // first `)`, so `rows.filter((r) => r.id).length` walked straight through
    // the guard - which is how this was found, by mutating it.
    expect(
      table,
      'a count is being tallied over the rows the table already has',
    ).not.toMatch(/rows\s*\.filter\([\s\S]{0,120}?\)\s*\.length/);
    expect(table, 'the view predicate is being called a second time').not.toContain(
      'intakeViewTest',
    );
  });

  it('offers the views the module defines rather than a list of its own', () => {
    // Derived, not spelled out. A hardcoded tab list is how a view gets added
    // to the module and never appears, or is renamed in one place only.
    expect(table).toContain('INTAKE_LIST_VIEW_KEYS');
    expect(table).toContain('INTAKE_LIST_VIEW_LABEL');
    for (const key of INTAKE_LIST_VIEW_KEYS) {
      expect(
        table,
        `the ${key} view is written out here instead of being derived`,
      ).not.toContain(`key === '${key}'`);
    }
    // "Mine" is the one view that is conditionally dropped, because a Mine
    // showing the whole firm's queue would be a lie.
    expect(table).toMatch(/!==\s*'mine'\s*\|\|\s*meId/);
  });

  it('states the range on screen against the size of the set', () => {
    expect(table).toContain('page.from');
    expect(table).toContain('page.to');
    expect(table).toContain('page.total');
  });
});

describe('the queue speaks this product’s vocabulary and not a service desk’s', () => {
  const surfaces = [codeOf(PAGE), codeOf(TABLE)];

  it('names no client tier, no service level and no escalation', () => {
    // Each of these is a real column on the reference and a fiction here.
    for (const word of ['VIP', 'SLA', 'Escalat', 'Breached']) {
      for (const src of surfaces) {
        expect(src, `the queue says "${word}", which this product cannot know`)
          .not.toContain(word);
      }
    }
  });

  it('grades priority in the four words the product actually stores', () => {
    // Not P1/P2. INTAKE_PRIORITIES is the one list, and a second spelling of
    // it is the copy that drifts.
    for (const src of surfaces) {
      expect(src).not.toMatch(/\bP[1-4]\b/);
    }
    expect(surfaces.join('\n')).toContain('INTAKE_PRIORITIES');
  });

  it('paints and labels a status from the shared workflow module', () => {
    const table = surfaces[1];
    expect(table).toContain('intake-workflow');
    expect(table).toContain('WORKFLOW_LABEL');
    expect(table).toContain('workflowColor');
    // The list this replaced kept its own seven-status label map, which is how
    // the inbox and the record came to call one request two different things.
    expect(table, 'a local status label map has grown back').not.toMatch(
      /STATUS_LABEL\s*(:|=)/,
    );
  });

  it('titles a row with intakeTitle, never with the requester’s name', () => {
    // client_name holds the REQUESTER on the partner path, which is how the
    // inbox showed a person where a subject belongs.
    const page = surfaces[0];
    expect(page).toContain('intakeTitle(');
    expect(page, 'the subject is being read straight off client_name').not.toMatch(
      /subject:\s*\w*\.client_name/,
    );
  });
});
