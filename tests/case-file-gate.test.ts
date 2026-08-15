import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * Every litigation surface refuses server-side, and refuses in the right
 * ORDER.
 *
 * tests/firm-staff-role-scope.test.ts and tests/export-matter-reference.test.ts
 * drive five of these for real. This file covers the rest, which have no
 * behavioural harness to run them through, and it is source-level for that
 * reason and no other.
 *
 * THE FALSE PASS THIS FILE IS BUILT TO AVOID. A source-level guard test that
 * asserts an identifier is MENTIONED proves nothing: an import at the top of a
 * file satisfies it while the gate below goes on letting everyone through.
 * Four such passes were found in one agent's work on this repo in a single
 * day. So every assertion here reads the body of the specific function or
 * handler and asserts the guard is CALLED inside it, and the ordering
 * assertions compare character offsets rather than trusting that the call
 * exists somewhere.
 *
 * Mutations, each verified red:
 *   - delete the guard from any listed gate or handler: that row goes red.
 *   - move the guard above its access check: the ordering test goes red while
 *     the presence test stays green, which is the pair working.
 *   - replace a call with a bare import: "applied, not merely imported" goes
 *     red.
 */

/** The five action modules, and the private gate every export funnels through. */
const GATED_MODULES = [
  'lib/firm-approach-actions.ts',
  'lib/firm-timeline-actions.ts',
  'lib/firm-legal-review-actions.ts',
  'lib/case-evidence-actions.ts',
  'lib/case-evidence-bulk.ts',
] as const;

/** Read one function's body: from its signature to the next top-level `}`. */
function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the five action modules ask the case file inside their gate', () => {
  it.each(GATED_MODULES)('%s calls the guard in assertFirmCase', (file) => {
    const src = read(file);
    const wrapper = bodyOf(src, 'async function assertFirmCase(');
    expect(
      wrapper,
      'the gate does not call caseFileRefusal, so the import above it is decoration',
    ).toContain('await caseFileRefusal(caseId)');
  });

  it.each(GATED_MODULES)('%s asks it AFTER proving access, not before', (file) => {
    const src = read(file);
    const wrapper = bodyOf(src, 'async function assertFirmCase(');
    const access = wrapper.indexOf('assertFirmCaseAccess(');
    const mode = wrapper.indexOf('caseFileRefusal(');
    expect(access, 'the access check is gone from the gate').toBeGreaterThan(-1);
    expect(
      mode,
      'caseFileRefusal reads a row by id, so asking it first turns the refusal into an existence oracle for matter ids',
    ).toBeGreaterThan(access);
  });

  it.each(GATED_MODULES)('%s still refuses on the access check alone', (file) => {
    // The wrapper must SHORT-CIRCUIT. Without the early return it would run
    // the case-file read for a caller with no access at all, which is the same
    // disclosure the ordering test above exists to prevent.
    const wrapper = bodyOf(read(file), 'async function assertFirmCase(');
    expect(wrapper).toMatch(/if \(!gate\.ok\) return gate;/);
  });
});

/**
 * The route handlers. Each renders no layout and no page, so nothing else in
 * the request stands between a URL and the matter's contents.
 */
const GATED_ROUTES = [
  'app/counsel/cases/[id]/export/route.ts',
  'app/counsel/cases/[id]/approach/[approachId]/export/route.ts',
  'app/counsel/cases/[id]/share/route.ts',
  'app/counsel/cases/[id]/search-index/route.ts',
  'app/counsel/cases/[id]/evidence/download/route.ts',
] as const;

describe('every case route refuses a closed case file', () => {
  it.each(GATED_ROUTES)('%s returns 403 rather than the document', (file) => {
    const src = read(file);
    expect(src, 'applied, not merely imported').toContain(
      'await caseFileRefusal(params.id)',
    );
    const at = src.indexOf('await caseFileRefusal(params.id)');
    const after = src.slice(at, at + 400);
    expect(after, 'the refusal is computed and then ignored').toMatch(
      /status: 403/,
    );
  });

  it.each(GATED_ROUTES)('%s proves access first', (file) => {
    const src = read(file);
    // The matter-belongs-to-this-firm check is the last of the access checks
    // in all five, and the guard must sit below it.
    const ownership = src.indexOf("c.firm_id !== firmId");
    const mode = src.indexOf('await caseFileRefusal(params.id)');
    expect(ownership).toBeGreaterThan(-1);
    expect(mode).toBeGreaterThan(ownership);
  });
});

/** The pages, which redirect rather than 403 because a person is reading. */
const GATED_PAGES = [
  'app/counsel/cases/[id]/timeline/page.tsx',
  'app/counsel/cases/[id]/evidence/page.tsx',
  'app/counsel/cases/[id]/preview/page.tsx',
] as const;

describe('every case sub-page turns a reader away', () => {
  it.each(GATED_PAGES)('%s sends them back to the matter', (file) => {
    const src = read(file);
    expect(src).toContain('await caseFileIsOpen(params.id)');
    const at = src.indexOf('await caseFileIsOpen(params.id)');
    expect(src.slice(at, at + 200)).toMatch(
      /redirect\(`\/counsel\/cases\/\$\{params\.id\}`\)/,
    );
  });
});

describe('the matter page itself', () => {
  const page = read('app/counsel/cases/[id]/page.tsx');

  it('resolves the mode and gates the four litigation surfaces on it', () => {
    expect(page).toContain('getCaseFileState(params.id)');
    expect(page).toContain("const litigation = caseFile.mode === 'litigation'");
    // Each of the four, gated on the same one variable. Named individually so
    // that adding a fifth surface without gating it is a visible omission
    // rather than an invisible one.
    expect(page).toMatch(/\{litigation && \(\s*<CaseMenu/);
    expect(page).toMatch(/\{showTimeBilling && litigation && \(/);
    expect(page).toMatch(/\{litigation && caseAnalytics \?/);
    expect(page).toMatch(/\{litigation && \(\s*<div id="case-approaches"/);
  });

  it('offers the switch in BOTH modes', () => {
    // A control that only appears in the mode it can leave is a control
    // nobody finds, and a simple matter would have no way to the case tools.
    const at = page.indexOf('<CaseFilePanel');
    expect(at).toBeGreaterThan(-1);
    const before = page.slice(Math.max(0, at - 600), at);
    expect(
      before,
      'the panel is itself inside a litigation-only branch',
    ).not.toMatch(/\{litigation && \($/m);
  });

  it('keeps every non-litigation surface in both modes', () => {
    // The promise that this is a gate and not a deletion. None of these is a
    // court surface, and none may acquire the flag.
    for (const surface of [
      '<MatterFacts',
      '<NamingConventions',
      '<EditMatterForm',
      '<MatterChatSection',
      '<CaseInvitePanel',
      '<LinkedProjectsPanel',
    ]) {
      const at = page.indexOf(surface);
      expect(at, `${surface} is gone from the page`).toBeGreaterThan(-1);
      expect(
        page.slice(Math.max(0, at - 120), at),
        `${surface} was put behind the litigation gate; it belongs to any matter`,
      ).not.toContain('litigation &&');
    }
  });

  it('still states the billing figures when the metric strip is gone', () => {
    // The strip comes off in simple mode. The numbers must not come off with
    // it, or hiding a dashboard would have quietly hidden data.
    expect(page).toMatch(/\{!litigation && \(/);
    expect(page).toContain('fmtHours(totalSeconds)');
    expect(page).toContain('fmtHours(billableSeconds)');
    expect(page).toContain('fmtCents(unbilledCents)');
    expect(page).toContain('fmtCents(trustBalance)');
  });
});

describe('the write that flips it', () => {
  const src = read('lib/case-file-actions.ts');
  const body = bodyOf(src, 'export async function setCaseFileOpenAction');

  it('is gated on owner, admin or attorney, not merely on membership', () => {
    expect(body).toContain('callerHasFirmRole(firmId, FIRM_MANAGE_ROLES)');
  });

  it('answers the role before the matter lookup', () => {
    const role = body.indexOf('callerHasFirmRole');
    const lookup = body.indexOf("from('cases')");
    expect(role).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(role);
  });

  it('scopes the UPDATE itself to the matter AND the firm', () => {
    /*
     * The dominant vulnerability shape in this repo is a service-role write
     * that takes an id from its arguments and is gated only by the UI that
     * happens to pass the right one.
     *
     * This assertion is sliced from `.update(` deliberately. Written against
     * the whole function body it passed while the firm scope was stripped off
     * the update, because the ownership LOOKUP a few lines above carries the
     * same two filters and satisfied the pattern on its own. That false pass
     * was caught by mutating the update and watching this test stay green.
     */
    const update = body.slice(body.indexOf('.update({ litigation_mode'));
    expect(update, 'the update is gone').not.toBe('');
    expect(update).toContain(".eq('id', caseId)");
    expect(
      update,
      'the update is scoped by matter id alone, so the firm check is the caller being polite',
    ).toContain(".eq('firm_id', firmId)");
  });

  it('writes one column and touches no case work', () => {
    expect(body).not.toMatch(/\.delete\(\)/);
    for (const table of [
      'case_timeline_events',
      'case_approaches',
      'case_people',
      'case_timeline_narratives',
      'exhibits',
    ]) {
      expect(
        body,
        `switching the mode must not touch ${table}: nothing is deleted by closing a case file`,
      ).not.toContain(table);
    }
  });

  it('says plainly when the column is not there, rather than offering nothing that works', () => {
    expect(body).toContain("isUnknownColumnError(error, 'litigation_mode')");
    expect(body).toMatch(/pending database update/);
  });
});
