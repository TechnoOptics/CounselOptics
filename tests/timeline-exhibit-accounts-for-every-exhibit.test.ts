import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exhibitContentNote,
  generateTimelineExhibitPdf,
  type ExhibitFile,
  type TimelineExhibitData,
} from '../lib/pdf';

/**
 * The timeline exhibit must account for every file it lists.
 *
 * tests/export-accounts-for-every-exhibit.test.ts pins that rule for the case
 * packet, after three PDF exhibits went out promising "Full document follows on
 * the next pages." with nothing following. This is the same rule for the other
 * generator, and it was broken in the other direction: not a promise with
 * nothing behind it, but SILENCE.
 *
 * A .xlsx exhibit in the consumer timeline export got a card carrying a type
 * chip, a filename and a SHA-256, and nothing whatsoever about its contents.
 * The firm export of the same matter, through the same generator, parsed the
 * workbook and printed the figures as a table, because the firm route called
 * parseExhibitSheet and the consumer route never did. A reader of the consumer
 * packet had no way to tell whether the spreadsheet held nothing or whether the
 * document had simply dropped it.
 *
 * Include it, or name it and say why. Not silence.
 */

function file(over: Partial<ExhibitFile>): ExhibitFile {
  return {
    name: 'ledger.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 20_000,
    sha256: 'c'.repeat(64),
    image: null,
    ...over,
  };
}

describe('what the packet says about one non-image exhibit', () => {
  it('promises the pages only when the pages are really coming', () => {
    const note = exhibitContentNote(file({ pdf: Buffer.from('%PDF-') }));
    expect(note).toContain('pages that follow');
  });

  it('points at the table only when the table is really there', () => {
    const note = exhibitContentNote(
      file({ sheet: { tabs: [{ name: 'Q1', rows: [['a']], totalRows: 1, totalCols: 1 }] } }),
    );
    expect(note).toContain('below');
  });

  it('never stays silent about a file whose contents are absent', () => {
    for (const ex of [
      file({}),
      file({ sheet: null, pdf: null }),
      file({ name: 'call.m4a', mime: 'audio/mp4' }),
      file({ name: 'brief.docx', mime: 'application/msword' }),
      file({ name: 'clip.mov', mime: 'video/quicktime' }),
      file({ name: 'ledger.xlsx', sha256: '(file unavailable)' }),
      file({ sheet: { tabs: [] } }),
    ]) {
      const note = exhibitContentNote(ex);
      expect(note, `${ex.name} was described by nothing at all`).toBeTruthy();
      expect(note.toLowerCase()).toContain('not reproduced');
    }
  });

  it('says the bytes were never read when they were never read', () => {
    expect(exhibitContentNote(file({ sha256: '(file unavailable)' })).toLowerCase())
      .toContain('not retrieved');
    expect(exhibitContentNote(file({ sha256: 'c'.repeat(64) })).toLowerCase())
      .not.toContain('not retrieved');
  });

  it('carries no prompt text, no AI attribution and no product name', () => {
    const notes = [
      exhibitContentNote(file({})),
      exhibitContentNote(file({ sha256: '(file unavailable)' })),
      exhibitContentNote(file({ pdf: Buffer.from('%PDF-') })),
    ].join(' ').toLowerCase();
    for (const banned of ['advottic', 'bella', ' ai ', 'model', 'prompt']) {
      expect(notes, `a court-facing note must not mention "${banned.trim()}"`)
        .not.toContain(banned);
    }
  });
});

/* ------------------------------------------------------------------ */
/* On the rendered page.                                               */
/* ------------------------------------------------------------------ */

function data(exhibits: ExhibitFile[]): TimelineExhibitData {
  return {
    caseTitle: 'Doe v. Roe',
    caseRef: 'AB12CD34',
    subjectName: 'Jane Doe',
    preparedBy: 'Test Attorney',
    generatedAt: new Date('2026-08-10T12:00:00Z').toISOString(),
    narrative: null,
    entities: [],
    entries: [
      {
        index: 1,
        when: 'March 14, 2023',
        kind: 'Document',
        title: 'Operating expense workbook',
        context: 'The workbook produced in response to the second request.',
        summary: null,
        sourceLabel: 'Production',
        people: [],
        exhibits,
        coreDetails: [],
      },
    ],
  };
}

/**
 * The words on the page, with ALL whitespace removed.
 *
 * The extractor emits per-glyph spacing for any run PDFKit drew with
 * `characterSpacing`, so "Operating Expenses" comes back as
 * "O p e r a t i n g  E x p e n s e s" and collapsing runs of whitespace is not
 * enough to make a phrase assertable. Stripping whitespace entirely is: it
 * cannot turn absent text into present text, which is the only direction that
 * would make this test lie.
 */
async function textOf(bytes: Buffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const res = await extractText(pdf, { mergePages: true });
  const raw = Array.isArray(res.text) ? res.text.join('\n') : String(res.text ?? '');
  return raw.replace(/\s+/g, '');
}

/** The same, for a phrase written with ordinary spaces. */
const compact = (phrase: string) => phrase.replace(/\s+/g, '');

describe('a spreadsheet exhibit, on the page', () => {
  it('prints the figures when the workbook was parsed', async () => {
    const bytes = await generateTimelineExhibitPdf(
      data([
        file({
          sheet: {
            tabs: [
              {
                name: 'Operating Expenses',
                rows: [
                  ['Account', 'Amount'],
                  ['Repairs', '18,420.55'],
                ],
                totalRows: 2,
                totalCols: 2,
              },
            ],
          },
        }),
      ]),
    );
    const text = await textOf(bytes);
    expect(text).toContain(compact('18,420.55'));
    expect(text).toContain(compact('Operating Expenses'));
  });

  it('says so on the page when the workbook was not parsed', async () => {
    const bytes = await generateTimelineExhibitPdf(data([file({})]));
    const text = await textOf(bytes);
    expect(text).toContain(compact('ledger.xlsx'));
    expect(text.toLowerCase()).toContain(compact('not reproduced'));
  });
});

/* ------------------------------------------------------------------ */
/* The two routes into that generator must not disagree.               */
/* ------------------------------------------------------------------ */

describe('every route into the timeline exhibit parses a spreadsheet', () => {
  const ROUTES = [
    'app/counsel/cases/[id]/export/route.ts',
    'app/counsel/cases/[id]/approach/[approachId]/export/route.ts',
    'app/cases/[id]/timeline/export/route.ts',
  ];

  for (const route of ROUTES) {
    it(`${route} calls parseExhibitSheet`, () => {
      const src = readFileSync(join(__dirname, '..', route), 'utf8');
      // The IMPORT is stripped before looking, because it is not the thing that
      // matters and matching it is how this guard first failed: replacing the
      // call with `const sheet = null` left the import in place and the test
      // green. What is asserted is the invocation.
      const body = src
        .split('\n')
        .filter((line) => !/^\s*import\b/.test(line) && !/from '@\/lib\/exhibit-sheet'/.test(line))
        .join('\n');
      expect(
        body,
        'one generator, two answers: the firm packet printed the figures and the consumer packet showed a bare card',
      ).toContain('parseExhibitSheet(');
    });
  }
});
