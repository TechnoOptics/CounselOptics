import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One layout arithmetic, read by the renderer and by the preview.
 *
 * The preview is a client component and the renderer is a server module, and a
 * preview that disagrees with the document is worse than no preview, because
 * the firm trusts it and finds out at the recipient. That exact defect was
 * found and fixed on the letterhead work, which is why
 * tests/letterhead-single-layout.test.ts exists; this is the same guard for the
 * positions rather than the words.
 *
 * A source-level guard rather than a behavioural one, and for the same reason
 * that file gives: a behavioural test cannot tell a surface that READS the
 * shared arithmetic from one that reproduces it correctly today, and correct
 * today is exactly what a second copy always is. The node test environment
 * cannot render the client component either, and no jsdom is coming.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
    // Comments stripped before anything is asserted, because every one of these
    // files carries prose SAYING it reads the shared module and a guard that
    // greps the raw text is satisfied by the prose. Both comment forms go, and
    // the `[^:]` keeps a `https://` inside a string from reading as one.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SURFACES: Array<{ path: string; what: string }> = [
  { path: 'lib/branded-document-pdf.ts', what: 'the PDF renderer' },
  { path: 'components/counsel/DocumentLayoutFields.tsx', what: 'the builder preview' },
];

describe('both ends of the layout read lib/document-layout', () => {
  for (const surface of SURFACES) {
    it(`${surface.what} imports the shared module`, () => {
      expect(read(surface.path)).toMatch(/from '(\.|@\/lib)\/document-layout'/);
    });

    it(`${surface.what} asks for the measure rather than working it out`, () => {
      const source = read(surface.path);
      expect(source).toMatch(/resolveContentBox\s*\(/);
      // The measure was `W - M * 2` in the renderer before this module existed.
      // Any surface that writes that form again has a second opinion about
      // where the text starts, and the counterparty blanks are measured from it.
      expect(source).not.toMatch(/\bW\s*-\s*M\s*\*\s*2\b/);
      expect(source).not.toMatch(/-\s*(64|72)\s*\*\s*2\b/);
    });

    it(`${surface.what} asks where the watermark and the footer go`, () => {
      const source = read(surface.path);
      expect(source).toMatch(/resolveWatermarkPlacement\s*\(/);
      expect(source).toMatch(/resolveFooterPlacement\s*\(/);
      expect(source).toMatch(/resolveWatermark\s*\(/);
    });

    it(`${surface.what} asks which pages each band is on`, () => {
      expect(read(surface.path)).toMatch(/bandAppearsOnPage\s*\(/);
    });

    it(`${surface.what} composes the footer line from one place`, () => {
      const source = read(surface.path);
      expect(source).toMatch(/composeFooterText\s*\(/);
      // The line used to be a template literal here. Two of those is how a
      // preview starts saying something the document does not.
      expect(source).not.toMatch(/Generated \$\{/);
      expect(source).not.toMatch(/Page \$\{/);
    });

    it(`${surface.what} takes the page size from lib/template-field-boxes`, () => {
      const source = read(surface.path);
      expect(source).toMatch(/RENDERED_PAGE_WIDTH_PT/);
      expect(source).toMatch(/RENDERED_PAGE_HEIGHT_PT/);
      // A literal Letter page written out again is the drift that module was
      // created to prevent, and it is why lib/document-layout.ts takes the page
      // as an argument instead of declaring one.
      expect(source).not.toMatch(/\b612\b/);
      expect(source).not.toMatch(/\b792\b/);
    });
  }
});

describe('the pure module stays pure', () => {
  it('imports nothing at all', () => {
    // The preview is a client component and the renderer is a server module,
    // and `server-only` in this module's graph would break the first while a
    // React import would break the second. Being import-free is also what lets
    // vitest drive it under the node environment with no jsdom.
    const source = read('lib/document-layout.ts');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\s*\(/);
  });
});
