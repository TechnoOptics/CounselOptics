import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  INTAKE_STATUSES,
  intakeLaneFilter,
  intakeLaneOf,
  type IntakeLane,
} from '../lib/intake-lanes';

/**
 * The counsel dashboard states four intake lane figures and a
 * "new in the last 24 hours" figure, and the action center adds them up
 * into "N things need a human".
 *
 * Every one of those is a COUNT of a set, and until this test existed
 * they were tallied in JavaScript over a `firm_matter_intakes` read
 * capped at 200 rows. A firm past its 200th request therefore read a
 * floor labelled as a total, on the one card whose entire job is to say
 * how much work is outstanding. app/counsel/billing had already been
 * fixed the same way, by drawing Outstanding from a separate totals
 * query rather than from the invoice list it renders.
 *
 * Two things are held here, because either one alone can pass while the
 * number on the page is still wrong:
 *
 *   1. the queries behind the lane figures are count queries with no
 *      `.limit()` on them, and
 *   2. the lane each query selects is the lane lib/intake-lanes.ts says
 *      it is, for every status the schema allows AND for the ones it
 *      does not.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const dashboard = readFileSync(`${root}app/counsel/page.tsx`, 'utf8');

/** Each `.from('firm_matter_intakes')` call and the query chained onto it. */
function intakeQueries(src: string): string[] {
  return src
    .split("from('firm_matter_intakes')")
    .slice(1)
    // A query chain ends at the first blank line after it; taking a fixed
    // window instead would run one query's text into the next one's.
    .map((part) => part.split(/\n\s*\n/)[0]);
}

describe('the dashboard states intake counts, not intake floors', () => {
  const queries = intakeQueries(dashboard);

  it('finds the intake reads at all, so an empty sweep cannot pass', () => {
    // Four query sites: the lane counter (one builder, run for each of
    // the four lanes), the open-ticket count behind the headline figure,
    // the 24-hour arrival count, and the recent-five list. The four lanes
    // share a site by design - a second spelling of the same query is a
    // second chance for the lanes to drift.
    //
    // The open-ticket count is its own site rather than a sum of lanes on
    // purpose: the lanes are the seven-value `status`, which files a
    // `converted` request under Accepted, and the nine-state queue calls
    // that request open. Adding lanes would state a figure /counsel/inbox
    // disagrees with.
    expect(queries).toHaveLength(4);
  });

  it('bounds exactly the one read that is a list rather than a total', () => {
    const bounded = queries.filter((q) => q.includes('.limit('));
    expect(bounded).toHaveLength(1);
    // And that one is the recent-activity list: it is the only read that
    // selects the columns a row is drawn from.
    expect(bounded[0]).toContain('client_name');
    expect(bounded[0]).toContain('.limit(5)');
  });

  it('asks the database for every figure it states as a total', () => {
    const totals = queries.filter((q) => !q.includes('.limit('));
    expect(totals).toHaveLength(3);
    for (const q of totals) {
      expect(q, `a total read without an exact count: ${q}`).toContain(
        "count: 'exact'",
      );
      expect(q).toContain('head: true');
    }
  });

  it('draws all four lanes through that one counter', () => {
    for (const lane of ['attention', 'review', 'accepted', 'closed']) {
      expect(dashboard).toContain(`intakeCount('${lane}')`);
    }
  });

  it('no longer tallies lanes in JavaScript over the rows it read', () => {
    // The shape this replaced. `tallyIntakeLanes` is correct on a set it
    // is given in full and wrong on a page of one, so the dashboard is
    // the wrong caller for it however the lanes are spelled.
    expect(dashboard).not.toContain('tallyIntakeLanes');
    expect(dashboard).toContain('intakeLaneFilter');
  });
});

/**
 * The filter the page applies, evaluated the way PostgREST would, so the
 * assertion is about which requests each query returns rather than about
 * how the query is spelled.
 */
function laneOfByFilter(status: string | null): IntakeLane | 'nowhere' {
  const lanes: IntakeLane[] = ['attention', 'review', 'accepted', 'closed'];
  const matched = lanes.filter((lane) => {
    const f = intakeLaneFilter(lane);
    if (f.op === 'in') return status !== null && f.statuses.includes(status);
    // `.or('status.is.null,status.not.in.(...)')`, which is what the page
    // sends: SQL's NOT IN is null-blind, so the null arm is explicit.
    return status === null || !f.statuses.includes(status);
  });
  if (matched.length === 0) return 'nowhere';
  expect(matched, `${status} matched more than one lane`).toHaveLength(1);
  return matched[0];
}

describe('the lane a query selects is the lane the definition names', () => {
  it('places every status the schema allows exactly where intakeLaneOf does', () => {
    expect(INTAKE_STATUSES.length).toBeGreaterThanOrEqual(7);
    for (const status of INTAKE_STATUSES) {
      expect(laneOfByFilter(status), `status ${status}`).toBe(
        intakeLaneOf(status),
      );
    }
  });

  it('routes a status no lane claims to a person rather than nowhere', () => {
    // The reason "needs attention" is the complement of the other three
    // and not a list of its own. A status the code has never heard of -
    // a new one added to the CHECK constraint ahead of the code, or a
    // row written straight to the database - must land in front of
    // somebody. Spelled as `.in(attention statuses)` it would instead
    // appear in no lane on any surface, which is the failure mode this
    // whole file was written for.
    for (const unknown of ['awaiting_partner', 'ON_HOLD', '']) {
      expect(laneOfByFilter(unknown), `status ${unknown}`).toBe('attention');
      expect(intakeLaneOf(unknown)).toBe('attention');
    }
    expect(laneOfByFilter(null)).toBe('attention');
    expect(intakeLaneOf(null)).toBe('attention');
  });

  it('leaves no status in two lanes, so the four can be summed', () => {
    // The action center sums lanes into one headline. Overlapping lanes
    // would double-count a request into that sum.
    const seen = new Set<string>();
    for (const status of INTAKE_STATUSES) {
      expect(seen.has(status)).toBe(false);
      seen.add(status);
      // laneOfByFilter asserts single membership internally; calling it
      // is the assertion.
      laneOfByFilter(status);
    }
  });
});
