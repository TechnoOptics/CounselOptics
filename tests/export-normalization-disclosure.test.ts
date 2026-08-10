import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  generateTimelineExhibitPdf,
  normalizeExhibitData,
  type TimelineExhibitData,
} from '../lib/pdf';
import { stripComments } from './support/strip-comments';

/**
 * `cases.text_normalizations` is a find-and-replace applied to the text of a
 * court-ready export. The exhibit asserts, in its own Certification section,
 * that it reproduces the record and that digests prove files are unaltered.
 * A substitution nobody can see, on a document offered as a true account, is a
 * document-integrity problem: a firm could file wording that never appeared in
 * the source and have no way to know.
 *
 * These guards hold the two halves of the fix that a reader depends on:
 *
 *   1. the function that PERFORMS the substitution is the one that REPORTS it,
 *      so the disclosure cannot drift away from what was actually done, and it
 *      reports only rules that changed something;
 *   2. the rendered PDF states the substitution in words a reader can find.
 *
 * (2) is checked against the extracted text of a real generated PDF, not
 * against source. This repo has a standing lesson that green unit tests missed
 * defects that were obvious on the rendered page.
 */

const png = readFileSync('public/icon-192.png');

function sample(): TimelineExhibitData {
  return {
    caseTitle: 'In re SH: Placement Review',
    caseRef: 'AB12CD34',
    subjectName: 'SH',
    preparedBy: 'Test Attorney',
    generatedAt: new Date('2026-08-09T12:00:00Z').toISOString(),
    narrative: {
      summary: 'SH was placed on March 14.',
      narrative: 'The county contacted SH twice. Cash payments were not at issue.',
      conclusion: 'SH remains in placement.',
    },
    entities: [
      {
        name: 'SH',
        kind: 'person',
        roleLabel: 'Subject',
        aliases: ['S.H.'],
        notes: 'Referenced throughout.',
        photo: null,
        appearances: 2,
      },
    ],
    entries: [
      {
        index: 1,
        when: 'March 14, 2023',
        kind: 'Document',
        title: 'Placement notice for SH',
        context: 'Sent to SH by the county.',
        summary: 'Notice of placement.',
        sourceLabel: 'County file',
        people: ['SH'],
        exhibits: [
          {
            name: 'SH-notice.pdf',
            mime: 'application/pdf',
            sizeBytes: 1234,
            sha256: 'c'.repeat(64),
            image: null,
          },
        ],
        coreDetails: [{ label: 'Source', value: 'County file' }],
      },
    ],
  };
}

async function pdfText(buf: Buffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const res = await extractText(doc, { mergePages: true });
  return (Array.isArray(res.text) ? res.text.join('\n') : res.text).replace(/\s+/g, ' ');
}

describe('normalizeExhibitData reports what it substituted', () => {
  it('records the rules that actually changed text', () => {
    const out = normalizeExhibitData(sample(), [
      { from: 'SH', to: 'STH' },
      { from: 'Nowhere', to: 'Somewhere' },
    ]);
    // The substitution really happened.
    expect(out.subjectName).toBe('STH');
    expect(out.narrative?.summary).toBe('STH was placed on March 14.');
    // And it is reported: the applied rule, and only the applied rule. A rule
    // that matched nothing produced no substitution in this document, so
    // naming it would describe the exhibit inaccurately.
    expect(out.normalizations).toEqual([{ from: 'SH', to: 'STH' }]);
  });

  it('leaves reproduced source files verbatim and does not claim otherwise', () => {
    const out = normalizeExhibitData(sample(), [{ from: 'SH', to: 'STH' }]);
    expect(out.entries[0].exhibits[0].name).toBe('SH-notice.pdf');
    expect(out.entries[0].exhibits[0].sha256).toBe('c'.repeat(64));
  });

  it('does not print an alias that the substitution collapsed onto the name', () => {
    // Found by reading the rendered page, not by a unit test: the party
    // profile read "STH a.k.a. STH" because the rule rewrote "S.H." and "SH"
    // to the same string.
    const out = normalizeExhibitData(sample(), [{ from: 'SH', to: 'STH' }]);
    expect(out.entities[0].name).toBe('STH');
    expect(out.entities[0].aliases).toEqual([]);
  });

  it('keeps aliases that are still distinct after substitution', () => {
    const data = sample();
    data.entities[0].aliases = ['S.H.', 'the minor'];
    const out = normalizeExhibitData(data, [{ from: 'SH', to: 'STH' }]);
    expect(out.entities[0].aliases).toEqual(['the minor']);
  });

  it('reports nothing when no rule matches, so a clean exhibit stays silent', () => {
    const out = normalizeExhibitData(sample(), [{ from: 'Nowhere', to: 'Somewhere' }]);
    expect(out.normalizations).toEqual([]);
  });

  it('is the substitution function itself that reports, not the caller', () => {
    // The disclosure must not be something a call site can forget to pass. If
    // `normalizations` ever became a caller-supplied field, an export could
    // substitute text and stay silent about it.
    const src = stripComments(readFileSync('lib/pdf.ts', 'utf8'));
    expect(src).toMatch(/normalizations:\s*rules\.filter/);
  });
});

describe('the exported PDF discloses its own substitutions', () => {
  it('states the substitution on the page when one was applied', async () => {
    const normalized = normalizeExhibitData(sample(), [{ from: 'SH', to: 'STH' }]);
    const text = await pdfText(await generateTimelineExhibitPdf(normalized));

    expect(text).toMatch(/Naming conventions\./);
    expect(text).toMatch(/"SH" is written as "STH"/);
    // The reader is told the reproduced evidence was not touched.
    expect(text).toMatch(/Source files reproduced or referenced herein/);
    // And the substituted text really is in the document.
    expect(text).toContain('STH');
  });

  it('still discloses when only one section was exported', async () => {
    // A section-scoped pull is filed just like the full packet, and the
    // Certification is the one section that always renders. If the disclosure
    // ever moved into an optional section, a subset export would go silent.
    const data = sample();
    data.sections = ['exhibits'];
    const normalized = normalizeExhibitData(data, [{ from: 'SH', to: 'STH' }]);
    const text = await pdfText(await generateTimelineExhibitPdf(normalized));
    expect(text).toMatch(/"SH" is written as "STH"/);
  });

  it('says nothing about naming conventions when nothing was substituted', async () => {
    const text = await pdfText(await generateTimelineExhibitPdf(sample()));
    expect(text).not.toMatch(/Naming conventions\./);
  });
});

describe('the firm can see the map in the app', () => {
  it('the matter page reads text_normalizations and renders the panel', () => {
    const page = stripComments(readFileSync('app/counsel/cases/[id]/page.tsx', 'utf8'));
    expect(page).toContain('text_normalizations');
    expect(page).toMatch(/<NamingConventions\s+rules=\{c\.text_normalizations\}/);
  });

  it('the panel shows every rule and marks the rule text data-no-translate', () => {
    const src = stripComments(
      readFileSync('app/counsel/cases/[id]/naming-conventions.tsx', 'utf8'),
    );
    // Machine translation must not rewrite the very strings being disclosed.
    // Asked file-wide, this was answered by the attribute sitting on any
    // element at all: moving it off the <li> and onto the eyebrow left the
    // disclosed from/to strings translatable and stayed green. It has to be
    // on the element that renders them.
    expect(src).toMatch(/parsed\.map\(/);
    const at = src.indexOf('parsed.map(');
    expect(at, 'the panel no longer maps the parsed rules').toBeGreaterThan(-1);
    const row = src.slice(at, at + 500);
    expect(row).toContain('data-no-translate');
    expect(row).toMatch(/\{r\.from\}/);
    expect(row).toMatch(/\{r\.to\}/);
  });
});
