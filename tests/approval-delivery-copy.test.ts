import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The reviewer is told the delivery that will actually happen.
 *
 * A template submission leaves the building one of two ways: as a read-only
 * encrypted share with the key mailed separately, or as a signing request with
 * a link and a separate access code. The approval page stated the first one
 * unconditionally, and the page around it never passed the mode down, so an
 * attorney approving a signature-mode document read a sentence describing a
 * delivery that was not going to take place. That is the one moment they take
 * responsibility for the document, so the wording is a correctness requirement
 * and not a style preference.
 *
 * The employee's own fill page already conditions on the mode, and its
 * signature branch is the phrasing this repo has settled on. This file holds
 * the two surfaces to the same mechanism rather than letting a second
 * vocabulary grow beside the first.
 *
 * Anchored on the source because the node test environment has no DOM and no
 * React renderer, which is the same reason tests/employee-form-intent.ts and
 * tests/counsel-live-defects.ts read source. The wiring itself has a second
 * guard that a grep cannot give: deliveryMode is a REQUIRED prop on
 * ReviewActions, so a page that stops passing it fails `tsc --noEmit`.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const REVIEW_ACTIONS = 'app/counsel/forms/approvals/[id]/review-actions.tsx';
const APPROVAL_PAGE = 'app/counsel/forms/approvals/[id]/page.tsx';
const EMPLOYEE_FORM = 'app/portal/forms/[id]/form-fill-client.tsx';

describe('the approval page names the delivery it will perform', () => {
  it('has the page hand the resolved mode to the decision panel', () => {
    // The defect exactly: the panel took no mode and the page passed none.
    expect(read(APPROVAL_PAGE)).toMatch(/deliveryMode=\{/);
  });

  it('has the decision panel take the mode and branch on it', () => {
    const src = read(REVIEW_ACTIONS);
    expect(src).toMatch(/deliveryMode: DeliveryMode/);
    expect(src).toMatch(/deliveryMode === 'signature'/);
  });

  it('states the encrypted share only on the share branch', () => {
    const src = read(REVIEW_ACTIONS);
    const [share, signature] = branches(src);
    expect(share).toContain('encrypted link');
    expect(share).toContain('key in a separate email');
    expect(signature).not.toContain('encrypted link');
  });

  it('names the signing mechanism the employee form already names', () => {
    // Not a second phrasing. Both surfaces say a link, a separate access
    // code, and a request to sign, because they describe one delivery.
    const [, signature] = branches(read(REVIEW_ACTIONS));
    const employee = flatten(read(EMPLOYEE_FORM));
    for (const phrase of ['a link and a separate access code', 'sign']) {
      expect(signature).toContain(phrase);
      expect(employee).toContain(phrase);
    }
    expect(signature).not.toContain('key in a separate email');
  });
});

/** JSX wraps these sentences across lines; the words are the assertion. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * The two sentences, split at the mode test.
 *
 * Deliberately crude: this proves only that two distinct texts exist on
 * either side of the branch and that each says the right thing. Anything
 * cleverer would be parsing JSX, and the type-level guard above is what
 * actually holds the wiring.
 */
function branches(src: string): [string, string] {
  const at = src.indexOf("deliveryMode === 'signature'");
  expect(at).toBeGreaterThan(-1);
  const rest = src.slice(at);
  const split = rest.indexOf(') : (');
  expect(split).toBeGreaterThan(-1);
  const end = rest.indexOf(')}', split);
  expect(end).toBeGreaterThan(split);
  return [flatten(rest.slice(split, end)), flatten(rest.slice(0, split))];
}
