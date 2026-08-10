import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Everyone is told the delivery that actually happened, or will.
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
const EMPLOYEE_STATUS = 'app/portal/forms/submissions/[id]/page.tsx';

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
    // NOT the bare word 'sign'. The signature slice begins with the anchor
    // `deliveryMode === 'signature'`, so `toContain('sign')` could never
    // fail, and the employee file is full of signing vocabulary. Rewording
    // the reviewer's panel from "asks them to sign the document" to "asks
    // them to return the document" left this green. The phrase is what both
    // surfaces have to share.
    for (const phrase of ['a link and a separate access code', 'to sign']) {
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
 * Comments removed before the copy is located.
 *
 * Not optional. The first version of the employee-page assertion below found
 * the phrase it was looking for inside the comment explaining the fix, which
 * sat above the branch, and reported the branch as absent. A copy assertion
 * that can be satisfied or defeated by prose about the copy is not an
 * assertion about the copy.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
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

/**
 * The same defect one page over, and worse there.
 *
 * The employee's status page said unconditionally, for status 'sent', that
 * the document went out as an encrypted link and that the decryption key
 * followed in a separate email. Both delivery modes end at that status, so a
 * signature-mode submission told the employee, as a completed fact, that
 * something was mailed which was not: it was a signing link and a one-time
 * access code.
 *
 * The reviewer's panel described a future action and this asserts a past one,
 * which is the harder kind to be wrong about. It is also the employee who
 * gets the phone call when the recipient asks what they were sent, so this is
 * the screen that decides whether they can answer.
 */
describe('the employee is told what was actually sent', () => {
  const src = () => read(EMPLOYEE_STATUS);

  it('reads the mode the action already returns', () => {
    // The data was in hand: this page already renders a signing panel off
    // res.signing, and getTemplateSubmissionAction already returns the mode.
    expect(src()).toContain('res.deliveryMode');
  });

  it('claims an encrypted link and a key only on the share branch', () => {
    const s = flatten(withoutComments(src()));
    const at = s.indexOf('encrypted link');
    expect(at).toBeGreaterThan(-1);
    // The claim is inside a mode test rather than standing alone under the
    // status test, which is the whole defect.
    expect(s.slice(0, at)).toContain("=== 'signature'");
  });

  it('tells a signature-mode employee about the link and the access code', () => {
    const s = flatten(withoutComments(src()));
    expect(s).toContain('a link and a separate access code');
    // The words the fill page and the reviewer's panel already use for the
    // same delivery. Three surfaces, one vocabulary.
    expect(flatten(read(EMPLOYEE_FORM))).toContain('a link and a separate access code');
  });

  it('says it in the past tense, because this screen reports what happened', () => {
    const s = flatten(withoutComments(src()));
    // Scoped to the signature branch. Read over the whole file, the only
    // match was `went to them` in the SHARE branch, so the signature
    // branch's tense was never measured and rewriting it to "the recipient
    // gets a link ... and is asked to sign it" stayed green.
    const at = s.indexOf("deliveryMode === 'signature'");
    expect(at, 'the status page no longer branches on the delivery mode').toBeGreaterThan(-1);
    const signature = s.slice(at, at + 400);
    expect(signature).toMatch(/We emailed|we emailed|was emailed|went to them/);
    expect(signature).not.toMatch(/we will email|gets a link|is asked to/);
    expect(s).not.toContain('we will email');
  });
});
