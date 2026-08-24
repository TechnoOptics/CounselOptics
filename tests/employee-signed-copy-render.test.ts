import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/strip-comments';

/**
 * The employee's own record of a document they signed shows the real pages and
 * their own mark.
 *
 * WHY THIS IS A SOURCE GUARD. vitest runs in the node environment in this repo
 * and jsdom is deliberately absent, so no test here can render a page and look
 * at it. What a test CAN hold is that the wiring is still the wiring: that this
 * surface asks for the branded document rather than the reflowed text, and that
 * it hands the deck and the fallback a real mark rather than null.
 *
 * EVERY MATCH BELOW IS AGAINST COMMENT-STRIPPED SOURCE, and every one asserts a
 * CALL rather than a name. Guards in this repo have twice been satisfied by the
 * comment that explains the fix, and once by an import line, so a guard that
 * could pass on prose is worth less than no guard at all.
 */

const ROOT = join(__dirname, '..');
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

/** Source with its import statements removed, so a name cannot satisfy a call. */
const withoutImports = (src: string) =>
  src.replace(/^import\s[\s\S]*?from\s+'[^']+';$/gm, '').replace(/^import\s+'[^']+';$/gm, '');

const SUBMISSION_PAGE = 'app/portal/forms/submissions/[id]/page.tsx';
const DECK = 'components/SignedCopyDeck.tsx';

describe('the employee is shown the document, not an approximation of it', () => {
  it('renders the branded deck on the submission page', () => {
    const src = read(SUBMISSION_PAGE);
    const el = /<SignedCopyDeck\b([\s\S]*?)\/>/.exec(src);
    expect(el, 'the submission page renders no SignedCopyDeck element').not.toBeNull();
    const props = el![1];
    // The four the route needs to answer at all, each read off the submission
    // this page loaded rather than off anything a browser supplied.
    expect(props).toMatch(/submissionId=\{submission\.id\}/);
    expect(props).toMatch(/revision=\{submission\.revision\}/);
    expect(props).toMatch(/documentText=\{submission\.documentText\}/);
    expect(props).toMatch(/markUrl=\{markUrl\}/);
  });

  it('never passes a null mark to the text sheets on this page', () => {
    // The exact defect: markSrc={null} meant the one person whose signature is
    // on the document was the only one in the chain who could not see it.
    const src = read(SUBMISSION_PAGE);
    expect(src).not.toMatch(/markSrc=\{null\}/);
    const sheets = [...src.matchAll(/<DocumentSheets\b([\s\S]*?)\/>/g)];
    expect(sheets.length).toBeGreaterThan(0);
    for (const [, props] of sheets) {
      expect(props).toMatch(/markSrc=\{markUrl\}/);
    }
  });

  it('fetches the mark itself rather than only naming the helper', () => {
    const src = withoutImports(read(SUBMISSION_PAGE));
    // A call, and one that is actually awaited into the value the deck is given.
    expect(src).toMatch(/const\s+markUrl\s*=[\s\S]{0,120}?\bsignedMarkUrl\s*\(/);
  });

  it('decides what to show through the tested rule rather than inline', () => {
    const src = withoutImports(read(SUBMISSION_PAGE));
    expect(src).toMatch(/const\s+signedCopy\s*=\s*resolveSignedCopyView\s*\(/);
    expect(src).toMatch(/signedCopy\.kind === 'branded'/);
  });
});

describe('the deck asks for the filed document and says so when it cannot have it', () => {
  it('posts to the route that draws the STORED wording and the STORED mark', () => {
    const src = withoutImports(read(DECK));
    // The approvals preview route, which never re-merges the live template.
    // Asserted as the argument of a fetch call, not as a string that happens
    // to appear somewhere in the file.
    expect(src).toMatch(/fetch\(\s*'\/api\/counsel\/approvals\/preview'/);
    // And NOT the draft-template route, which would re-merge today's template
    // and date the page today. See the component's own header.
    expect(src).not.toMatch(/draft-template/);
  });

  it('pins the request to the revision and wording this page rendered', () => {
    const src = withoutImports(read(DECK));
    expect(src).toMatch(/JSON\.stringify\(\{\s*submissionId,\s*revision,\s*documentText\s*\}\)/);
  });

  it('prints an honest line instead of degrading to the text in silence', () => {
    const src = withoutImports(read(DECK));
    // The notice is CALLED, in the fallback, and only when a build has failed.
    expect(src).toMatch(/\{failed && \(/);
    expect(src).toMatch(/\bbrandedCopyNotice\s*\(\s*failure\s*\)/);
    // The status is recorded from the server's own answer, so the sentence can
    // track the real reason rather than guessing at one.
    expect(src).toMatch(/setFailure\s*\(\s*res\.status\s*\)/);
  });
});

describe('the other two surfaces are left exactly as they were', () => {
  it('the approver still renders SubmissionPdfDeck', () => {
    const src = read('app/counsel/forms/approvals/[id]/page.tsx');
    expect(/<SubmissionPdfDeck\b([\s\S]*?)\/>/.test(src)).toBe(true);
    expect(src).not.toMatch(/<SignedCopyDeck\b/);
  });

  it('the fill page still renders DocumentPdfDeck with its own buildPdf', () => {
    const src = read('app/portal/forms/[id]/form-fill-client.tsx');
    const el = /<DocumentPdfDeck\b([\s\S]*?)\/>/.exec(src);
    expect(el).not.toBeNull();
    expect(el![1]).toMatch(/buildPdf=\{buildPdf\}/);
    expect(src).not.toMatch(/<SignedCopyDeck\b/);
  });
});
