import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The decision moves out of the right rail and into a modal raised from the
 * top action bar.
 *
 * The owner, an in-house GC, asked for exactly this after working his own
 * service desk: the reason is one or two sentences, it is required to
 * decline, and it belongs in a popup off the button at the top rather than as
 * a standing panel in the right side menu. The same request removed the
 * "Request details" and "Matter" panels from that rail.
 *
 * WHAT THE MODAL WRITES IS NOT NEW STORAGE. decideIntakeAction already
 * requires a reason for 'declined' and already stores it at
 * intake_answers.decision.reason, and app/portal/[id]/page.tsx already renders
 * it back to the employee who filed the request. The modal is a new way in to
 * the same field, so there is no migration here and no second copy of the
 * reason.
 *
 * These are source-reading guards, so every one of them strips comments before
 * matching. This repo has twice shipped a guard that passed only because the
 * comment explaining the fix contained the string the guard searched for.
 */

const path = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), 'utf8');
const exists = (rel: string) => existsSync(path(rel));

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

const codeOf = (rel: string) => stripComments(read(rel));

const PAGE = 'app/counsel/intake/[id]/page.tsx';
const DECIDE = 'app/counsel/intake/[id]/decide-request.tsx';

/**
 * The comment stripper is itself load-bearing, so it is tested. If it ever
 * stopped removing comments, every assertion below would start passing on
 * prose alone.
 */
describe('the guards in this file read code, not comments', () => {
  it('strips block, JSX and line comments', () => {
    expect(stripComments('/* Matter */ a')).not.toContain('Matter');
    expect(stripComments('{/* Request details */} a')).not.toContain(
      'Request details',
    );
    expect(stripComments('a // Decline or close')).not.toContain('Decline');
  });

  it('reads files that are actually there', () => {
    for (const rel of [PAGE, DECIDE]) expect(exists(rel)).toBe(true);
  });
});

describe('the decision is a modal raised from the action bar', () => {
  /**
   * Mutation: drop the Dialog import from decide-request.tsx and render the
   * form inline again. This goes red.
   */
  it('builds the popup from the shared Dialog', () => {
    const code = codeOf(DECIDE);
    expect(code).toContain("from '@/components/Dialog'");
    expect(code).toContain('<Dialog');
  });

  /**
   * The reason is required on the client as well as on the server. The server
   * gate in decideIntakeAction is the one that decides, but a decline button
   * that is live with an empty box only fails after the click.
   *
   * Mutation: change the guard to `disabled={pending}`. This goes red.
   */
  it('will not let a decline be submitted without a reason', () => {
    expect(codeOf(DECIDE)).toContain('!reason.trim()');
  });

  /**
   * Mutation: move DecideRequest back into the <aside>. This goes red.
   */
  it('raises it from the action bar and not from the rail', () => {
    const code = codeOf(PAGE);
    const bar = code.slice(
      code.indexOf('<ActionBar'),
      code.indexOf('</ActionBar>'),
    );
    expect(bar).toContain('<DecideRequest');
    expect(code).not.toContain('DecideJump');
  });

  it('no longer ships the jump-to-section shim', () => {
    expect(exists('app/counsel/intake/[id]/decide-jump.tsx')).toBe(false);
  });
});

/**
 * The right side menu is the <aside>. Asserting against the whole file would
 * be the wrong test: two of these panels were removed from the rail and their
 * facts kept elsewhere on the page, which is the point.
 */
const railSource = () => {
  const code = codeOf(PAGE);
  const open = code.indexOf('<aside');
  const close = code.indexOf('</aside>');
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return code.slice(open, close);
};

describe('three panels are gone from the right side menu', () => {
  /**
   * Mutation: restore any one of these panels to the <aside>. That one goes
   * red.
   */
  it('has no decide section', () => {
    const rail = railSource();
    expect(rail).not.toContain('id="decide"');
    expect(rail).not.toContain('<DecideRequest');
  });

  it('has no Request details panel', () => {
    expect(railSource()).not.toContain('Request details');
  });

  it('has no Matter panel', () => {
    expect(railSource()).not.toContain('title={<T>Matter</T>}');
  });
});

/**
 * REMOVING A PANEL MUST NOT SILENTLY REMOVE A FACT.
 *
 * Jurisdiction rendered nowhere else on this screen, Confidentiality and
 * Expiry rendered nowhere else, and Type only reached the heading as the
 * title's second fallback, so a request carrying a subject showed no type at
 * all once the panel went. All four moved into the record in the left column,
 * which is also where the service desk this was modelled on puts them.
 *
 * Submitted by, Priority and Due by deliberately did NOT move: the header
 * already draws the first two and the action bar draws the deadline.
 */
describe('the facts those panels carried are still on the screen', () => {
  /**
   * Mutation: drop any line from recordFacts. That one goes red.
   */
  it.each([
    ['Type', 'matter_type'],
    ['Jurisdiction', 'jurisdiction_state'],
    ['Request type', 'request_type'],
    ['Confidentiality', 'confidentiality'],
    ['Expiry', 'expiry'],
  ])('still renders %s', (label, key) => {
    const code = codeOf(PAGE);
    const facts = code.slice(
      code.indexOf('const recordFacts'),
      code.indexOf('.filter((f) => f.value.length > 0)'),
    );
    expect(facts).toContain(label);
    expect(facts).toContain(key);
  });

  /**
   * Mutation: add Priority back to recordFacts. This goes red.
   */
  it.each(['submitted_by', 'due_by'])(
    'does not draw %s twice',
    (key) => {
      const code = codeOf(PAGE);
      const facts = code.slice(
        code.indexOf('const recordFacts'),
        code.indexOf('.filter((f) => f.value.length > 0)'),
      );
      expect(facts).not.toContain(key);
    },
  );

  /**
   * Drawn only when filled. docs/DESIGN.md forbids a header over nothing, and
   * an empty definition list under the summary would be exactly that.
   *
   * Mutation: render the list unconditionally. This goes red.
   */
  it('draws nothing when none of them are filled', () => {
    expect(codeOf(PAGE)).toContain('recordFacts.length > 0');
  });
});

/**
 * THE READ PATH THE MATTER PANEL CARRIED MUST SURVIVE ITS PANEL.
 *
 * Two production requests were converted to matters before that write path
 * was removed, and the link in the Matter panel was the ONLY screen in the
 * product that pointed at them. Deleting the panel without moving the link
 * would hide two live matters. The link therefore moves to the action bar
 * rather than going away with the panel it happened to live in.
 *
 * tests/ticket-not-a-matter.test.ts asserts the link still exists and is drawn
 * exactly once; this asserts where it now is.
 */
describe('a request that already became a matter still points at it', () => {
  /**
   * Mutation: delete the link along with the panel. This goes red, and so do
   * two assertions in tests/ticket-not-a-matter.test.ts.
   */
  it('keeps the link, in the action bar', () => {
    const code = codeOf(PAGE);
    const bar = code.slice(
      code.indexOf('<ActionBar'),
      code.indexOf('</ActionBar>'),
    );
    expect(bar).toContain('/counsel/cases/${caseId}');
    expect(bar).toContain('Open the matter');
  });
});
