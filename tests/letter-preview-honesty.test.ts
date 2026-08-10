import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LETTER_DRAFT_NOTICE } from '../lib/letter-compose';

/**
 * The letter studio previews a PDF and SAVES a Word document.
 *
 * That is deliberate: a letter is meant to be edited, so .docx is the right
 * deliverable and lib/letters-actions.ts renders one. It also means the
 * preview is not a picture of what saving produces, which is the same
 * divergence a drifting preview would have, in a different coat. The dialog
 * says so above the viewer, and this file holds the sentence to the facts it
 * asserts.
 *
 * Each check below fails if the sentence stops being true, which is the only
 * useful thing a test can do about on-screen copy.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const STUDIO = read('../app/counsel/letters/letters-studio.tsx');
const SAVE = read('../lib/letters-actions.ts');
const DOCX = read('../lib/docx-export.ts');

describe('the letter studio preview', () => {
  it('builds the PDF in one place, so the preview and Export PDF cannot drift', () => {
    // Two copies of the payload, posted side by side, agree only until one of
    // them is edited. The preview's whole claim is that it is the export.
    const posts = STUDIO.split("'/api/counsel/draft-template/pdf'").length - 1;
    expect(posts).toBe(1);
    expect(STUDIO).toMatch(/buildPdf=\{buildPdfBlob\}/);
    // And the export goes through that same function rather than a second
    // fetch of its own.
    expect(STUDIO).toMatch(/blob = await buildPdfBlob\(\)/);
  });

  it('tells the reader that saving produces a Word document', () => {
    expect(STUDIO).toMatch(/note=\{/);
    expect(STUDIO).toMatch(/Word document instead/);
  });
});

describe('the facts that sentence rests on', () => {
  it('saving really does render Word, not PDF', () => {
    // If saving ever became a PDF, the note would be telling a reader their
    // letter is filed in a format it is not.
    expect(SAVE).toMatch(/generateLetterDocx\(/);
    expect(SAVE).toMatch(/\.docx/);
    expect(SAVE).not.toMatch(/buildBrandedDocumentPdf/);
  });

  it('the draft notice really does travel with both files', () => {
    // The PDF gets it appended to the composed text; the Word file carries it
    // in the page footer. Same sentence, two places, and the note says so.
    expect(STUDIO).toMatch(/\$\{LETTER_DRAFT_NOTICE\}/);
    expect(DOCX).toContain(LETTER_DRAFT_NOTICE);
  });
});
