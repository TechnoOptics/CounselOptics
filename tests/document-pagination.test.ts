import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { LABEL_RE } from '../lib/signature-anchor-text';
import {
  BODY_LEAD_PT,
  locateLine,
  pageGeometry,
  paginate,
  wrapLine,
} from '../lib/document-pagination';

/**
 * The preview shows a document as PAGES.
 *
 * Reported, and then measured live on production against a real firm template:
 * the preview was one `whitespace-pre-wrap` block inside a `max-h-[70vh]
 * overflow-y-auto` pane whose clientHeight was 530px around a scrollHeight of
 * 4168px. So a person about to sign saw about an eighth of the document at a
 * time, through a window that also captured the wheel so the page behind it
 * would not scroll.
 */

describe('how much fits on a page', () => {
  const geom = pageGeometry();

  it('derives a plausible page from the renderer geometry, not a picked number', () => {
    // US Letter is 792pt tall. With the default margins and 16pt leading there
    // is room for tens of lines, not hundreds and not three. The bounds are
    // deliberately loose: the point is that the number comes from the page box,
    // so a layout change moves it, and a nonsense value fails here.
    expect(geom.linesPerPage).toBeGreaterThan(20);
    expect(geom.linesPerPage).toBeLessThan(60);
    expect(geom.charsPerLine).toBeGreaterThan(40);
    expect(geom.widthPt).toBe(612);
    expect(geom.heightPt).toBe(792);
  });

  it('uses the same leading the renderer uses', () => {
    // The mutation this kills: changing BODY_LEAD_PT here without changing LEAD
    // in the renderer. They are two files and there is no import between them,
    // so this reads the renderer's source and compares.
    const src = readFileSync(join(process.cwd(), 'lib/branded-document-pdf.ts'), 'utf8');
    const m = /const LEAD = (\d+)/.exec(src);
    expect(m, 'lib/branded-document-pdf.ts no longer declares LEAD').not.toBeNull();
    expect(Number(m![1])).toBe(BODY_LEAD_PT);
  });
});

describe('wrapping a line', () => {
  it('leaves a short line alone', () => {
    expect(wrapLine('short', 20)).toEqual(['short']);
  });

  it('breaks on whitespace', () => {
    expect(wrapLine('aaa bbb ccc ddd', 7)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('cuts a single token wider than the measure', () => {
    // Without this, one long token (a URL, an account number) sits on a line of
    // its own and the page count is right while the sheet overflows. The
    // pieces must be full-width, so the count stays honest.
    expect(wrapLine('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('never returns a piece wider than the measure', () => {
    // The general form of the case above. This is the assertion that kills a
    // "wrap" that only splits on spaces and gives up on long tokens.
    const line = `${'x'.repeat(50)} word ${'y'.repeat(30)}`;
    for (const piece of wrapLine(line, 12)) {
      expect(piece.length).toBeLessThanOrEqual(12);
    }
  });
});

describe('splitting a document into pages', () => {
  it('returns one page for a short document', () => {
    expect(paginate('A short letter.')).toHaveLength(1);
  });

  it('returns a sheet even for nothing at all', () => {
    // An empty preview reads as a failure to load. An empty sheet reads as an
    // empty document, which is the truth.
    expect(paginate('')).toEqual(['']);
  });

  it('splits a long document across several pages', () => {
    const geom = pageGeometry();
    const text = Array.from({ length: geom.linesPerPage * 3 }, (_, i) => `line ${i}`).join('\n');
    expect(paginate(text)).toHaveLength(3);
  });

  it('loses no text across the split', () => {
    // The defect a page-splitter is most likely to ship: an off-by-one that
    // drops a line at every boundary. Rejoining the pages must give back every
    // line, in order.
    const geom = pageGeometry();
    const lines = Array.from({ length: geom.linesPerPage * 2 + 7 }, (_, i) => `line ${i}`);
    const pages = paginate(lines.join('\n'));
    expect(pages.join('\n').split('\n')).toEqual(lines);
  });
});

describe('finding the sheet the signature belongs on', () => {
  const geom = pageGeometry();
  const lines = Array.from({ length: geom.linesPerPage * 2 + 5 }, (_, i) => `line ${i}`);
  const text = lines.join('\n');

  it('puts an early line on the first sheet', () => {
    expect(locateLine(text, 3)).toEqual({ page: 0, lineInPage: 3 });
  });

  it('puts a line past the first sheet on a later one', () => {
    // The mutation this kills: returning `{page: 0}` always, which is what a
    // paginated view does when nobody translated the mark's source line. The
    // signature would then be drawn on page one of a signature block that is on
    // page three, which is the reported "it does not show up on the preview"
    // wearing a different face.
    const at = locateLine(text, geom.linesPerPage + 2);
    expect(at.page).toBe(1);
    expect(at.lineInPage).toBe(2);
  });

  it('resolves a line past the end of the document to the end', () => {
    // Out of range must still draw. Dropping the mark is the defect.
    const at = locateLine(text, 10_000);
    expect(at.page).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(at.page)).toBe(true);
  });

  it('accounts for wrapped lines, not just source lines', () => {
    // A source line that wraps to four rendered lines pushes everything after
    // it down by four, not by one. Counting source lines would put the mark
    // roughly a page too high in any real contract, where paragraphs wrap.
    const wide = 'w'.repeat(geom.charsPerLine * 4);
    const doc = [wide, ...Array.from({ length: 10 }, (_, i) => `line ${i}`)].join('\n');
    const at = locateLine(doc, 1);
    expect(at.lineInPage).toBeGreaterThanOrEqual(4);
  });
});

describe('the preview surfaces do not re-introduce the scroll pane', () => {
  /**
   * The three surfaces that show a document to somebody deciding whether to
   * sign it. A max-height plus overflow on any of them is the exact pane that
   * was measured at 530px around 4168px of content, and it also captures the
   * wheel so the page will not scroll. This is a source-reading guard because
   * vitest here runs in node with no DOM, and the alternative is nothing.
   */
  const SURFACES = [
    'app/portal/forms/[id]/form-fill-client.tsx',
    'app/portal/forms/submissions/[id]/page.tsx',
    'app/counsel/forms/approvals/[id]/page.tsx',
  ];

  for (const f of SURFACES) {
    it(`${f} renders sheets rather than a scrolling column`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(src).toContain('<DocumentSheets');
      // Comments stripped first, because the comment left at the call site
      // explains the pane it replaced and has to be able to name it. A rule
      // that cannot survive its own documentation is a trap for whoever
      // explains the next change, and this repository has set that trap once
      // already.
      expect(
        src,
        `${f} still wraps the document in a max-height scroll pane`,
      ).not.toMatch(/max-h-\[70vh\][^"']*overflow-y-auto/);
    });
  }
});

describe('the signature is brought into view when it lands', () => {
  /**
   * A guard on the WIRING, not on the maths.
   *
   * The signature block is the last thing in most of these documents, so a mark
   * that renders correctly still lands several pages away from wherever the
   * signer is looking, and from their chair that is indistinguishable from it
   * not rendering. So the deck turns to it.
   *
   * This lived on the fill page as a scrollIntoView while the preview was a
   * column. The deck owns it now, which is the right place: all three surfaces
   * get it instead of the one that happened to have the effect.
   */
  const SHEETS = readFileSync(join(process.cwd(), 'components/DocumentSheets.tsx'), 'utf8')
    // Comments stripped, and this is not cosmetic: without it an earlier
    // version of this guard PASSED after the thing it checked was renamed,
    // because the comment above still spelled the old name. A guard satisfied
    // by its own documentation is the defect this file's neighbours exist to
    // stop, and it was caught by mutating rather than by reading.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('turns to the page carrying the mark', () => {
    expect(SHEETS).toMatch(/setIndex\(markPage\)/);
  });

  it('only turns when the mark changes, never on every render', () => {
    // Without the dependency the deck would snap back to the signature while
    // somebody is reading a clause on another page.
    expect(SHEETS).toMatch(/\}, \[markSrc, markPage\]\);/);
  });

  it('clamps the mark to a real page', () => {
    // locateLine can resolve past the last page on a document whose signature
    // block sits after the text it measured. Turning to a page that does not
    // exist shows a blank frame, which reads as the document failing to load.
    expect(SHEETS).toMatch(/Math\.min\(at\.page, count - 1\)/);
  });

  it('draws the mark with an entrance rather than swapping it in', () => {
    expect(SHEETS).toMatch(/doc-mark-in/);
    expect(SHEETS).toMatch(/prefers-reduced-motion/);
  });
});

describe('a sheet never hides text', () => {
  /**
   * Caught by RENDERING the page and looking at it, after twenty green tests.
   *
   * The first version of the sheet used `h-full overflow-hidden` inside the
   * aspect-ratio box, which turned an approximate page break into a hard clip:
   * the opening sheet cut a definition of Confidential Information off
   * mid-sentence, because the lines-per-page estimate under-counts what a
   * browser fits at its own font size.
   *
   * The estimate being loose is a cosmetic fault. Truncating a covenant in
   * front of somebody about to sign it is not. So the aspect ratio has to act
   * as a minimum, which means no fixed height and no clip on the text.
   */
  const SHEETS = readFileSync(join(process.cwd(), 'components/DocumentSheets.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  /**
   * The TEXT container specifically, not the deck frame.
   *
   * The frame legitimately clips: it is the mask that keeps the pages waiting
   * off to the side out of sight. Banning overflow-hidden everywhere in this
   * file would fail on that and teach whoever hits it to delete the rule. What
   * must never clip is the element holding the words.
   */
  const textContainer = /className="([^"]*whitespace-pre-wrap[^"]*)"/.exec(SHEETS);

  it('has a text container to check', () => {
    expect(textContainer, 'no whitespace-pre-wrap container found in the sheet').not.toBeNull();
  });

  it('does not clip the words', () => {
    expect(
      textContainer![1],
      'the document text is clipped, so a sheet can hide terms from a signer',
    ).not.toMatch(/overflow-hidden/);
  });

  it('does not pin the words to a fixed height', () => {
    // h-full inside the aspect-ratio box is what makes the ratio a ceiling
    // rather than a floor. Without it the text is never cut short.
    expect(textContainer![1]).not.toMatch(/\bh-full\b/);
  });

  it('still sets the page proportions', () => {
    // The ratio must survive the fix. Removing it would stop the clipping too,
    // and stop the sheets being sheets.
    expect(SHEETS).toMatch(/aspectRatio/);
  });
});

describe('the employee preview renders the real document', () => {
  /**
   * Asked why an uploaded contract lost its pages and its formatting, the
   * answer was that a firm template stores plain TEXT: lib/firm-templates.ts
   * extracts the words at upload and the file itself is never kept. So no
   * preview can show the original layout.
   *
   * But the document the employee sends is not that text either. It is a PDF
   * this app builds, with real pagination and a real signature box, and that
   * PDF can be rendered exactly. These guards hold the two properties that make
   * the difference real rather than decorative.
   */
  const DECK = readFileSync(join(process.cwd(), 'components/DocumentPdfDeck.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');
  const FILL = readFileSync(
    join(process.cwd(), 'app/portal/forms/[id]/form-fill-client.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('reuses the signer page renderer rather than a second one', () => {
    // The signer page rasterises the document for reasons recorded there: an
    // iframe could not put the mark on the real signature line and an overlay
    // came apart on the first scroll. A second renderer would be a second set
    // of those bugs, and the employee and the recipient would stop looking at
    // the same pixels.
    expect(DECK).toMatch(/from '\.\.\/app\/sign\/\[token\]\/pdf-runtime'/);
    expect(DECK).toMatch(/renderPageToCanvas/);
  });

  it('finds the signature page by reading the document, not by assuming', () => {
    // Assuming the last page is wrong on a mutual agreement with blocks on two
    // pages, and wrong again whenever an appendix follows the signatures.
    expect(DECK).toMatch(/from '@\/lib\/signature-anchor-text'/);
    // The CALL, not the import. The first version of this guard matched
    // `LABEL_RE` anywhere in the file, so it passed with the search replaced by
    // "assume the last page" while the import sat there unused. A pure helper
    // that nothing invokes is this repository's most repeated failure, and the
    // guard has to hold the call site as well as the presence.
    expect(DECK, 'LABEL_RE is imported but never tested against the page text').toMatch(
      /LABEL_RE\.test\(/,
    );
    expect(DECK).not.toMatch(/sigPage = pageCount - 1/);
  });

  it('discards a stale build instead of showing it', () => {
    // A slow early build landing after a fast later one would put stale pages
    // on screen, which on a document somebody is about to sign is the worst
    // kind of wrong: it looks settled.
    expect(DECK).toMatch(/generation\.current/);
    expect(DECK).toMatch(/mine !== generation\.current/);
  });

  it('falls back to readable text rather than an empty frame', () => {
    expect(DECK).toMatch(/'failed'/);
    expect(FILL).toMatch(/fallback=\{/);
    expect(FILL).toMatch(/<DocumentSheets/);
  });

  it('rebuilds on everything that changes the document', () => {
    // A revision that omits an input leaves the preview stale while looking
    // settled. All three of the values, the typed name and the mark change what
    // the PDF says.
    const m = /revision=\{JSON\.stringify\(\[([^\]]*)\]\)\}/.exec(FILL);
    expect(m, 'the deck no longer declares what it rebuilds on').not.toBeNull();
    for (const input of ['values', 'signature', 'markSrc']) {
      expect(m![1], `${input} does not trigger a rebuild`).toContain(input);
    }
  });
});

describe('the pages are actually painted', () => {
  /**
   * Caught by MEASURING the live page, not by any test here.
   *
   * The first version called renderPageToCanvas in the same effect that set the
   * page list. React had not created the canvases yet, so every ref was null
   * and a `continue` skipped all of them without a word. On production six
   * canvases sat at their 300x150 default having never been drawn to, inside a
   * deck that reported "Page 1 of 6" and looked finished.
   *
   * app/sign/[token]/pdf-runtime.ts says it plainly: a canvas that allocated
   * but drew nothing is the most convincing way to appear to have shown
   * somebody a document without having shown them anything.
   */
  const DECK = readFileSync(join(process.cwd(), 'components/DocumentPdfDeck.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('paints in a pass that runs after the canvases exist', () => {
    // The paint effect must depend on the page list, which is what creates the
    // canvas elements. Painting inside the build effect is the defect.
    const paints = DECK.slice(DECK.indexOf('renderPageToCanvas({'));
    expect(paints, 'no paint effect keyed on the page list').toMatch(/\}, \[pages\]\);/);
  });

  it('treats a missing canvas as a failure, never as something to skip', () => {
    // `continue` here is what made a deck of blank pages look rendered.
    expect(DECK).toMatch(/if \(!canvas\) throw/);
    expect(DECK).not.toMatch(/if \(!canvas\) continue/);
  });

  it('does not paint from a superseded build', () => {
    expect(DECK).toMatch(/held\.generation !== generation\.current/);
  });
});

describe('the approver sees the real document too', () => {
  /**
   * The attorney on the approvals page decides the document leaves the
   * building, so of the three people in the chain they have the strongest
   * claim to be shown what actually gets sent.
   *
   * A wrapper exists because the approvals page is a server component and a
   * function cannot cross that boundary, so buildPdf has to be built on the
   * client from plain data.
   */
  const WRAP = readFileSync(join(process.cwd(), 'components/SubmissionPdfDeck.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');
  const PAGE = readFileSync(
    join(process.cwd(), 'app/counsel/forms/approvals/[id]/page.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('uses employee mode, so the server merges the firm published template', () => {
    // Counsel mode renders whatever free text the body carries and would have
    // been less work. Employee mode makes the server load the firm's own
    // published template and merge the values itself, so the approver is shown
    // a document built the way the recipient's is rather than one assembled
    // from text this page happened to hold.
    expect(WRAP).toMatch(/templateId,/);
    expect(WRAP).toMatch(/'\/api\/counsel\/draft-template\/pdf'/);
  });

  it('converts the mark here rather than handing the server a URL', () => {
    // A server that fetches a URL out of a request body is a request-forgery
    // surface, and this route deliberately is not one. The conversion belongs
    // on the client.
    expect(WRAP).toMatch(/readAsDataURL/);
    expect(WRAP).not.toMatch(/signatureUrl:/);
  });

  it('waits for the mark before the first build', () => {
    // Otherwise the approver is shown an unsigned document that silently gains
    // a signature, which on this page looks like the document changed under
    // them mid-decision.
    expect(WRAP).toMatch(/if \(!markResolved\) return/);
  });

  it('keeps the text sheets where there is no template to render from', () => {
    // A free-text submission has no published template behind it, so there is
    // nothing for employee mode to load.
    expect(PAGE).toMatch(/s\.templateId \? \(/);
    expect(PAGE).toMatch(/<DocumentSheets/);
    expect(PAGE).toMatch(/fallback=\{<DocumentSheets/);
  });
});

describe('a hanging preview gives up instead of waiting forever', () => {
  /**
   * The defect this exists for, measured on the live approvals page:
   *
   *   POST /api/counsel/draft-template/pdf   ->  200
   *   GET  /pdf-worker/<v>/pdf.worker.min.mjs -> pending, every attempt
   *   console errors                          -> none
   *
   * openSignerPdf awaits that worker, so the promise never settled. The catch
   * never ran, the status stayed at its opening value, and the deck showed its
   * fallback for as long as the page was open. Nothing looked wrong, which is
   * the worst shape a defect can take: it reads as "this surface just does not
   * have the feature".
   *
   * A `catch` only helps against a THROW. Neither the build nor the open may be
   * awaited without a deadline.
   */
  const DECK = readFileSync(join(process.cwd(), 'components/DocumentPdfDeck.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('bounds the PDF build', () => {
    // Called through the ref rather than the prop: the prop is a new function
    // on every render and having it in the effect's deps starved the debounce
    // so the rebuild never ran. See "the rebuild is not starved by re-renders".
    expect(DECK).toMatch(/withDeadline\(buildRef\.current\(\)/);
  });

  it('bounds opening the document, which is where the worker is awaited', () => {
    // The build returned 200. The hang was in the open. Bounding only the
    // build would have left the actual defect in place while looking fixed.
    expect(DECK).toMatch(/withDeadline\(\s*openSignerPdf\(bytes\)/);
  });

  it('rejects rather than resolving, so the failure path runs', () => {
    // A deadline that RESOLVES on timeout would skip the catch and leave the
    // component believing it had a document.
    const fn = DECK.slice(DECK.indexOf('function withDeadline'));
    expect(fn).toMatch(/reject\(new Error/);
  });

  it('gives up sooner than the signing ceremony does', () => {
    // 120s is right for a render that gates a signature and is spent once. A
    // preview beside a form being filled in must fail while the person still
    // connects the delay to the document.
    const m = /const PREVIEW_BUILD_TIMEOUT_MS = ([\d_]+);/.exec(DECK);
    expect(m, 'no preview timeout declared').not.toBeNull();
    const ms = Number(m![1].replace(/_/g, ''));
    expect(ms).toBeGreaterThan(5_000);
    expect(ms).toBeLessThan(120_000);
  });
});

describe('the document can be seen all at once', () => {
  /**
   * Asked for on the approvals page, and that is the surface that most needs
   * it: an approver is deciding whether a document goes out, which raises
   * questions ("how long is this", "where are the signature blocks") that a
   * one-page-at-a-time view answers slowly and a wall of pages answers at a
   * glance.
   */
  const SHEETS = readFileSync(join(process.cwd(), 'components/DocumentSheets.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  /** Only the overview branch: it ends where the single-page one begins. */
  const overviewBranch = SHEETS.slice(
    SHEETS.indexOf('Go to page'),
    SHEETS.indexOf('ref={frame}'),
  );

  it('the overview branch is found, and is not the whole file', () => {
    expect(overviewBranch.length).toBeGreaterThan(200);
    expect(overviewBranch.length).toBeLessThan(SHEETS.length / 2);
  });

  it('offers both views', () => {
    expect(SHEETS).toMatch(/const \[overview, setOverview\] = useState\(false\)/);
    expect(SHEETS).toMatch(/'One page'/);
    expect(SHEETS).toMatch(/'All pages'/);
  });

  it('opens on one page, not on the overview', () => {
    // The overview is for orientation. Opening in it would put a wall of
    // unreadable type in front of somebody who came to read a contract.
    expect(SHEETS).toMatch(/useState\(false\)/);
  });

  it('a page in the overview is a real control, not a decorated div', () => {
    // Keyboard and screen reader users get there the same way, and the label
    // says which page rather than reading out the document's first words.
    expect(SHEETS).toMatch(/aria-label=\{`Go to page \$\{i \+ 1\}`\}/);
    expect(SHEETS).toMatch(/aria-current/);
  });

  it('draws the mark in the overview too', () => {
    // A signature that appears in one view and not the other would make the
    // overview a different document from the one being signed.
    // Bounded to the OVERVIEW branch. An unbounded slice from 'Go to page'
    // runs on into the single-page branch, which renders the mark too, so the
    // guard passed with the mark deleted from the grid. Caught by mutating.
    expect(overviewBranch).toMatch(/i === markPage/);
    expect(overviewBranch).toMatch(/<MarkedPage/);
  });

  it('keeps the real page proportions in the grid', () => {
    expect(overviewBranch).toMatch(/aspectRatio: `\$\{geom\.widthPt\} \/ \$\{geom\.heightPt\}`/);
  });

  it('the toggle says what it does', () => {
    // Not a bare glyph. This sits where an attorney decides whether a document
    // leaves the building.
    expect(SHEETS).toMatch(/aria-pressed=\{overview\}/);
  });
});

describe('the signed screen on a phone', () => {
  /**
   * The last thing a signer sees, and until now it was an eyebrow, a line of
   * thanks and a sentence, left-aligned at the top of a card. It read like a
   * form validation message at the end of a ceremony that had just put
   * somebody's name on a legal instrument.
   *
   * Photographed on a real Samsung, which is also how the layout faults on the
   * screen before it were found.
   */
  const PAD = readFileSync(
    join(process.cwd(), 'app/sign/m/[handoff]/mobile-pad.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');
  const QUERIES = readFileSync(
    join(process.cwd(), 'lib/signing-handoff-queries.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('carries the firm mark, and it is actually rendered', () => {
    // The CALL sites, not just the props. An earlier guard in this file passed
    // on an import that nothing used, which is why this checks that the value
    // reaches an element.
    expect(PAD).toMatch(/firmLogoUrl \? \(/);
    expect(PAD).toMatch(/src=\{firmLogoUrl\}/);
  });

  it('degrades to the firm name when there is no logo', () => {
    // A firm with no logo uploaded is the common case. The layout must not
    // have a hole in it.
    expect(PAD).toMatch(/\(firmLogoUrl \|\| firmName\)/);
  });

  it('uses a drawn mark, never an emoji', () => {
    // House rule, and it matters most here: a glyph borrowed from a chat app
    // would undercut the confirmation of a legal instrument.
    expect(PAD).toMatch(/sig-tick/);
    expect(PAD).not.toMatch(/[✅✔\uD83C-\uDBFF]/);
  });

  it('respects reduced motion', () => {
    expect(PAD).toMatch(/prefers-reduced-motion/);
  });

  it('branding never blocks signing', () => {
    // Every branding read is tolerated and returns nulls. A missing logo must
    // not be the reason somebody cannot sign, and this page is reached by
    // scanning a code with no session to fall back on.
    expect(QUERIES).toMatch(/firmName: string \| null/);
    expect(QUERIES).toMatch(/firmName = firm\?\.name\?\.trim\(\) \|\| null/);
  });
});

describe('every phone pad carries the firm mark', () => {
  /**
   * The defect this exists for, and it shipped: MobilePad is rendered by TWO
   * pages, because two ceremonies end on it. The outside signer's phone
   * COMPLETES a signature; the employee's phone hands a mark back to the desk.
   * Branding was wired into the signer's page only, so the employee path, which
   * is the one behind the QR code on the fill form, showed no logo at all.
   *
   * Caught by reading rather than by looking, because every live surface was
   * down at the time. It is exactly the shape of gap that a screenshot of ONE
   * of the two pages would have declared fixed.
   *
   * This enumerates the callers rather than checking a known list, so a THIRD
   * ceremony ending on this pad fails here instead of shipping unbranded.
   */
  const PAD_CALLERS = [
    'app/sign/m/[handoff]/pad/page.tsx',
    'app/sign/mark/[handoff]/pad/page.tsx',
  ];

  it('finds every page that renders the pad', () => {
    // If a third caller appears, this count changes and the loop below starts
    // covering it. A guard that hard-codes two would not notice.
    const found = execSync(
      "grep -rl '<MobilePad' app || true",
      { cwd: process.cwd(), encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .sort();
    expect(found).toEqual([...PAD_CALLERS].sort());
  });

  for (const f of PAD_CALLERS) {
    it(`${f} passes the firm branding through`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(src, `${f} renders MobilePad without firmName`).toMatch(/firmName=\{/);
      expect(src, `${f} renders MobilePad without firmLogoUrl`).toMatch(/firmLogoUrl=\{/);
    });
  }
});

describe('both decks offer the zoomed-out view', () => {
  /**
   * The defect this exists for, and it SHIPPED: the overview was asked for on
   * the approvals page and built into DocumentSheets, while approvals renders
   * DocumentPdfDeck. Confirmed in a live browser on production: zero overview
   * buttons on that page. The feature did not exist where it was asked for.
   *
   * Same shape as the MobilePad branding gap the same day. Two components do
   * the same job for different inputs; wiring one and testing that one reads
   * as done.
   */
  const DECKS = ['components/DocumentSheets.tsx', 'components/DocumentPdfDeck.tsx'];
  const read = (f: string) =>
    readFileSync(join(process.cwd(), f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\/[^\n]*/g, '');

  for (const f of DECKS) {
    it(`${f} has an overview mode`, () => {
      const src = read(f);
      expect(src, `${f} has no overview state`).toMatch(/const \[overview, setOverview\]/);
      expect(src, `${f} never offers a way into overview`).toMatch(/setOverview\(true\)/);
      expect(src, `${f} never offers a way back out`).toMatch(/setOverview\(false\)/);
    });
  }

  it('the two decks label the control identically', () => {
    /**
     * The controls are duplicated on purpose: the decks have different
     * internals. What must not drift is what the reader SEES, so the two are
     * compared to EACH OTHER rather than to a hard-coded string.
     *
     * The first version of this compared aria-label and failed against correct
     * code, because the two toggles carried the same visible words through
     * different attributes: DocumentSheets used aria-pressed, which is the
     * right choice for a toggle whose visible text is already its name. So the
     * assertion moved to the visible text, which is what the sentence above
     * says it is protecting, and the a11y attribute is checked separately.
     */
    const labels = DECKS.map((f) => {
      const m = read(f).match(/\{overview \? '([^']+)' : '([^']+)'\}\s*<\/button>/);
      expect(m, `${f} has no ViewToggle text pair`).not.toBeNull();
      return [m![1], m![2]];
    });
    expect(labels[0]).toEqual(labels[1]);
  });

  it('both toggles announce their state the same way', () => {
    // aria-pressed, not aria-label: the visible text is already the name, and
    // an aria-label would override it with a second copy that can drift.
    for (const f of DECKS) {
      expect(read(f), `${f} does not announce toggle state`).toMatch(
        /aria-pressed=\{overview\}/,
      );
    }
  });

  it('the PDF deck keeps its canvases mounted across the switch', () => {
    // Remounting would lose the painted bitmaps and repaint every page, which
    // is a visible stall and a fresh chance at the blank-canvas failure this
    // component already shipped once. One map, two layouts.
    const src = read('components/DocumentPdfDeck.tsx');
    expect(src.match(/canvases\.current\[i\] = el/g) ?? []).toHaveLength(1);
  });

  it('overview never marks a visible page hidden', () => {
    // In overview every page is on screen. Leaving the inert and aria-hidden
    // logic unconditional would take the whole document out of the
    // accessibility tree at the moment it is all visible.
    const src = read('components/DocumentPdfDeck.tsx');
    expect(src).toMatch(/aria-hidden=\{overview \? undefined : i !== index\}/);
    expect(src).toMatch(/!overview && i !== index/);
  });
});

describe('a thumbnail shows the whole page', () => {
  /**
   * Found by rendering the overview and looking at it, with 62 tests green.
   *
   * renderPageToCanvas sets the canvas width and height INLINE, at a
   * device-pixel-ratio-corrected size. An inline style beats a class, so every
   * thumbnail kept its full deck width and the clipping cell showed only the
   * top-left corner of each page: the title read "Mutual N", cut off mid-word.
   *
   * A thumbnail that shows a corner is worse than no thumbnail, because the
   * whole point of the view is answering "where are the signature blocks" at a
   * glance.
   */
  const DECK = readFileSync(join(process.cwd(), 'components/DocumentPdfDeck.tsx'), 'utf8');

  it('forces the canvas to the cell, over the inline paint size', () => {
    expect(DECK).toMatch(/\.doc-thumb canvas \{[^}]*width: 100% !important/);
    expect(DECK).toMatch(/\.doc-thumb canvas \{[^}]*height: 100% !important/);
  });

  it('the rule targets the class the thumbnails actually carry', () => {
    // The pairing that matters. A rule naming a class nothing renders is the
    // shape of dead guard this file has caught twice already.
    const stripped = DECK.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped, 'no thumbnail carries doc-thumb').toMatch(/\? `doc-thumb /);
  });
});

describe('the viewer can find the signature block this app writes', () => {
  /**
   * Reported: "I signed using the phone QR code and it has not showed up on the
   * document."
   *
   * Traced through the live database rather than guessed. The handoff was
   * healthy end to end:
   *
   *   created  22:13:05   QR minted
   *   consumed 22:13:29   phone scanned it
   *   mark_at  22:13:36   the phone's mark reached the server
   *   collect  22:13:37   the desk picked it up, 0.7s later
   *
   * (mark_png reads empty afterwards because the collect nulls it on purpose,
   * one-shot delivery with no replay. That is not evidence of an empty mark and
   * was nearly reported as one.)
   *
   * So the signature WAS on the page. The viewer could not find which page, so
   * it never turned to it, and a signature on page two of a document showing
   * page one is indistinguishable from no signature at all.
   *
   * The cause: LABEL_RE was written against a third-party NDA, whose labels are
   * `By:` and `Signature:`. Advottic's own block is `Signed: <name>`, and
   * nothing matched it.
   */
  it('matches the label mergeTemplateDocument actually emits', () => {
    expect(LABEL_RE.test('Signed: Techno Optics')).toBe(true);
  });

  it('the emitted block and the vocabulary are checked against each other', () => {
    // Not a hard-coded string on either side. The label is READ from the module
    // that writes it, so renaming the block without widening the vocabulary
    // fails here rather than silently costing another signing.
    const src = readFileSync(
      join(process.cwd(), 'lib/firm-template-placeholders.ts'),
      'utf8',
    );
    const m = /\\n\\n\\nSigned: \$\{([a-zA-Z]+)\}/.exec(src);
    expect(m, 'the employee signature block no longer reads "Signed: ..."').not.toBeNull();
    expect(LABEL_RE.test('Signed: anyone')).toBe(true);
  });

  it('still refuses the adjacent fields, which are not signature lines', () => {
    // The module excludes these on purpose: they have no rule to sit on, and
    // treating them as anchors would stack marks down the block.
    for (const s of ['Name: Jane', 'Title: CEO', 'Date: August 16, 2026', 'Email: a@b.c']) {
      expect(LABEL_RE.test(s), `${s} must not be a signature anchor`).toBe(false);
    }
  });
});

describe('the preview follows the field being filled in', () => {
  /**
   * Asked for directly: "whenever a user starts filling out a field in the left
   * panel, set focus to that section on the place they are filling."
   *
   * On a seven page agreement the input and the sentence it changes are usually
   * pages apart, so without this the preview is a document you scroll rather
   * than a document that answers you.
   */
  const read = (f: string) =>
    readFileSync(join(process.cwd(), f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\/[^\n]*/g, '');
  const DECK = read('components/DocumentPdfDeck.tsx');
  const FILL = read('app/portal/forms/[id]/form-fill-client.tsx');

  it('every field reports focus, not just some of them', () => {
    // On the shared input props, so a field added later inherits it. Wiring
    // each input by hand is how one gets missed.
    expect(FILL).toMatch(/onFocus: \(\) => setFocusedKey\(f\.key\)/);
  });

  it('searches for the value, not the label or the placeholder', () => {
    // The {{key}} is gone by the time the document is rendered, and the label
    // usually does not appear in the text at all.
    expect(FILL).toMatch(/values\[focusedKey\]/);
  });

  it('ignores values too short to find unambiguously', () => {
    // One or two characters match half the document, and a preview that jumps
    // to the wrong clause on every keystroke is worse than one that stays put.
    expect(FILL).toMatch(/v\.length >= 3/);
    expect(DECK).toMatch(/needle\.length < 3/);
  });

  it('stays put when the text is not found, rather than resetting to page one', () => {
    // A value whose rebuild has not landed yet is not a reason to take the
    // reader back to the front of the document.
    const fn = DECK.slice(DECK.indexOf('const needle'));
    const body = fn.slice(0, fn.indexOf('const drag'));
    expect(body).toMatch(/text\.includes\(needle\)/);
    expect(body, 'a not-found search must not move the deck').not.toMatch(
      /setIndex\(0\)/,
    );
  });

  it('never moves the deck while overview is open', () => {
    // Every page is visible there; moving underneath somebody would only take
    // the view away from them.
    expect(DECK).toMatch(/needle\.length < 3 \|\| overview/);
  });
});

describe('the rebuild is not starved by re-renders', () => {
  /**
   * Reported twice, and the second report is what found it: "I sign on my
   * phone, I get the thank you, but I do not see it on the rendered form on the
   * laptop."
   *
   * `buildPdf` is declared inline by the fill page, so it is a NEW REFERENCE on
   * every render. With it in the effect's dependency list, every render tore
   * down the pending 700ms debounce and started a fresh one. The phone handoff
   * card polls every 1.2s while it waits, so renders arrived faster than the
   * timer could elapse and the rebuild never ran at all. The deck went on
   * showing the pages it had already built, which were the unsigned ones.
   *
   * The signature really was recorded. It was never re-rendered.
   */
  const DECK = readFileSync(join(process.cwd(), 'components/DocumentPdfDeck.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('the build effect depends on the revision string alone', () => {
    // A function identity in this list restarts the debounce on every render.
    expect(DECK).toMatch(/\}, \[revision\]\);/);
    expect(DECK, 'buildPdf is a dependency again, which starves the debounce').not.toMatch(
      /\}, \[buildPdf, revision\]\);/,
    );
  });

  it('the build still calls the LATEST build function', () => {
    // A ref, not a captured stale closure. Dropping the dependency without the
    // ref would rebuild with whatever function the first render happened to
    // create, which is a different and quieter bug.
    expect(DECK).toMatch(/buildRef\.current\(\)/);
    expect(DECK).toMatch(/buildRef\.current = buildPdf/);
  });

  it('revision still carries the mark, or nothing would trigger a rebuild', () => {
    // The dependency and what it must contain are checked together. Narrowing
    // the deps is only safe while revision covers everything that changes the
    // document.
    const FILL = readFileSync(
      join(process.cwd(), 'app/portal/forms/[id]/form-fill-client.tsx'),
      'utf8',
    );
    const m = /revision=\{JSON\.stringify\(\[([^\]]*)\]\)\}/.exec(FILL);
    expect(m, 'the deck no longer declares what it rebuilds on').not.toBeNull();
    expect(m![1], 'the mark does not trigger a rebuild').toContain('markSrc');
  });
});

describe('the preview says why it failed', () => {
  /**
   * Four rounds of diagnosis were spent on the wrong causes for one bug: the
   * release gate, a 403 from a probe with fake ids, and a pdf worker that was
   * never the problem. Every one of them would have been settled in seconds by
   * the error these catches used to swallow.
   *
   * A silent catch on a surface that renders a contract is not defensive. It
   * converts a diagnosable failure into a mystery, and this component has now
   * shipped a defect in the build path AND one in the paint path.
   */
  const DECK = readFileSync(join(process.cwd(), 'components/DocumentPdfDeck.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('neither the build nor the paint swallows its error silently', () => {
    // The bare form is the defect. Binding the error is not enough on its own,
    // so the log is asserted separately below.
    expect(DECK, 'a catch is discarding its error again').not.toMatch(/\} catch \{\s*\n\s*(?!\s*return;)/);
  });

  it('names the build failure', () => {
    expect(DECK).toMatch(/console\.error\('\[preview\] build failed:', err\)/);
  });

  it('names the paint failure separately from the build', () => {
    // A build that succeeds and a paint that fails look identical from the
    // outside. Telling them apart is the point.
    expect(DECK).toMatch(/console\.error\('\[preview\] paint failed:', err\)/);
  });
});
