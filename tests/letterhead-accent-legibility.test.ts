import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBrandedDocumentPdf } from '../lib/branded-document-pdf';
import {
  AA_SMALL_TEXT,
  ACCENT_TEXT_SURFACES,
  DEFAULT_ACCENT,
  DOCUMENT_GROUNDS,
  accentTextOnDocument,
  contrastRatio,
  deriveAccentText,
  tightestSurface,
} from '../lib/accent-text';

/**
 * A firm's own name, on the stationery it sends clients and files with courts.
 *
 * The two studios painted `color: <the firm's accent hex>` on #fbfaf6 letterhead
 * stock, and those studios are a faithful preview of lib/branded-document-pdf.ts,
 * which drew the same hex onto white paper. Measured on the paper: Advottic's
 * own gold was 1.79:1 in the preview and 1.87:1 in print, and a firm gold of
 * #c79532 was 2.59:1 and 2.70:1. A colour chosen to work as a button FILL is
 * usually unreadable as text, which is the whole reason lib/accent-text.ts
 * exists, and an inline style is invisible to every class-based contrast guard.
 *
 * These tests hold the PRINTED document, not the preview, because the printed
 * document is the one that reaches a client and a court file.
 */

const PAPER = Object.values(DOCUMENT_GROUNDS);

/** Accents that already read as themselves on paper and must be left alone. */
const LEGIBLE_ON_PAPER = {
  navy: '#1f3a93',
  'platform forest (the accent a firm never chose)': '#0f2d24',
  black: '#000000',
  'deep crimson': '#7f1d1d',
};

/** Accents that cannot be read on paper and must be derived. */
const ILLEGIBLE_ON_PAPER = {
  'advottic gold': DEFAULT_ACCENT,
  'firm gold': '#c79532',
  'pale yellow': '#fff9c4',
  'pure yellow': '#ffff00',
  'pure cyan': '#00ffff',
  white: '#ffffff',
};

describe('the firm accent, as text on a document', () => {
  for (const [ground, hex] of Object.entries(DOCUMENT_GROUNDS)) {
    it(`clears ${AA_SMALL_TEXT}:1 on the ${ground} for every accent a firm can type`, () => {
      let worst = { ratio: Infinity, accent: '', text: '' };
      for (let r = 0; r < 256; r += 51) {
        for (let g = 0; g < 256; g += 51) {
          for (let b = 0; b < 256; b += 51) {
            const accent = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
            const text = accentTextOnDocument(accent);
            const ratio = contrastRatio(text, hex);
            if (ratio < worst.ratio) worst = { ratio, accent, text };
          }
        }
      }
      expect(
        worst.ratio,
        `${worst.accent} -> ${worst.text} measured ${worst.ratio.toFixed(3)}:1 on ${hex}`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }

  for (const [label, accent] of Object.entries(LEGIBLE_ON_PAPER)) {
    it(`keeps ${label} (${accent}) exactly, because it already reads on paper`, () => {
      expect(accentTextOnDocument(accent)).toBe(accent);
    });
  }

  for (const [label, accent] of Object.entries(ILLEGIBLE_ON_PAPER)) {
    it(`derives ${label} (${accent}), because it cannot be read on paper`, () => {
      const text = accentTextOnDocument(accent);
      expect(text).not.toBe(accent);
      expect(text).toBe(deriveAccentText(accent, 'light'));
    });
  }

  it('falls back to the platform accent for an unusable value', () => {
    for (const bad of ['', '   ', 'rebeccapurple', null, undefined]) {
      expect(accentTextOnDocument(bad)).toBe(accentTextOnDocument(DEFAULT_ACCENT));
    }
  });

  it('is the light tone, proved on grounds the light tone already covers', () => {
    // Both paper grounds are LIGHTER than cream-200, so naming them costs the
    // light pin nothing. If a future ground goes darker than cream-200, every
    // light-tone number in tests/accent-text.test.ts needs re-deriving, and
    // this is where that shows up.
    expect(tightestSurface('light')).toBe('#f5edd6');
    for (const hex of PAPER) {
      expect(Object.values(ACCENT_TEXT_SURFACES.light)).toContain(hex);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The printed document.                                               */
/* ------------------------------------------------------------------ */

const DESIGN = {
  firmName: 'Hartley and Vance LLP',
  addressLines: ['1 Market Street, Suite 900', 'San Francisco, CA 94105'],
  phone: '+1 415 555 0134',
  email: 'mail@hartleyvance.example',
  website: 'hartleyvance.example',
  admissionsLine: 'Admitted in California and New York',
  alignment: 'left' as const,
  showRule: true,
};

/** A valid one-pixel PNG, so the logo branch can actually be taken. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

afterEach(() => {
  vi.unstubAllGlobals();
});

const BODY =
  'This letter confirms the position we set out at our meeting on Tuesday. ' +
  'Nothing in it is intended to alter the terms of the agreement between the parties. '.repeat(4);

/**
 * The content streams of a rendered PDF, decompressed.
 *
 * Reading the operators rather than a screenshot, because the question is what
 * colour the ink IS, and pdf-lib writes that as a literal `r g b rg` in front of
 * the operator that uses it. `endstream` also ends in "stream", hence the
 * lookbehind: without it every stream is read twice, once from its own header
 * and once from garbage after its terminator.
 */
function contentStreams(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes);
  const text = raw.toString('latin1');
  const out: string[] = [];
  for (const m of text.matchAll(/(?<!end)stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end === -1) continue;
    const slice = raw.subarray(start, end);
    try {
      out.push(inflateSync(slice).toString('latin1'));
    } catch {
      out.push(slice.toString('latin1'));
    }
  }
  return out;
}

function hexOf(r: string, g: string, b: string): string {
  const part = (v: string) =>
    Math.round(Number(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Every run of text the PDF draws, with the fill colour in effect when it was
 * drawn. pdf-lib writes strings as hex inside `<...> Tj`, so the ink and the
 * words it drew can be read back together rather than separately - which is
 * what lets this assert about the FIRM'S NAME and not about, say, the grey the
 * page footer happens to use.
 */
function drawnInk(bytes: Uint8Array): { text: string; colour: string }[] {
  const out: { text: string; colour: string }[] = [];
  for (const stream of contentStreams(bytes)) {
    let colour: string | null = null;
    for (const op of stream.matchAll(
      /([\d.]+) ([\d.]+) ([\d.]+) rg|<([0-9A-Fa-f]*)> Tj/g,
    )) {
      if (op[4] !== undefined) {
        if (!colour) continue;
        const text = (op[4].match(/../g) ?? [])
          .map((pair) => String.fromCharCode(parseInt(pair, 16)))
          .join('');
        out.push({ text, colour });
        continue;
      }
      colour = hexOf(op[1], op[2], op[3]);
    }
  }
  return out;
}

/**
 * Every fill colour used to paint a closed path. pdf-lib draws a rectangle as
 * `m`/`l`/`h`/`f` rather than `re`, so this looks for the fill, not the shape.
 */
function shapeFillColours(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (const stream of contentStreams(bytes)) {
    for (const m of stream.matchAll(
      /([\d.]+) ([\d.]+) ([\d.]+) rg[\s\S]{0,300}?\nh\nf\n/g,
    )) {
      out.push(hexOf(m[1], m[2], m[3]));
    }
  }
  return out;
}

describe.each([
  ['advottic gold', DEFAULT_ACCENT],
  ['a firm gold', '#c79532'],
  ['a pale firm accent', '#fff9c4'],
])('a letter printed on %s (%s)', (_label, accent) => {
  /*
   * Every letterhead branch that draws the firm's NAME as text. The fourth, an
   * uploaded image, draws no text at all.
   *
   * The logo branch is here because leaving it out let a mutation live: reverting
   * that one draw back to the raw accent passed a green suite, since the branch
   * is only reached when the renderer successfully fetches a logo. So the fetch
   * is stubbed with a real one-pixel PNG rather than mocked away, which is the
   * same thing tests/branded-document-letterhead-design.test.ts does and for the
   * same reason: a branch nothing can reach is a branch nothing is proving.
   */
  const BRANCHES = {
    'the designed letterhead': { input: { letterheadDesign: DESIGN }, logo: false },
    'the text-only banner': { input: {}, logo: false },
    'the logo banner': { input: { logoUrl: 'https://example.test/logo.png' }, logo: true },
  };

  for (const [branch, { input, logo }] of Object.entries(BRANCHES)) {
    it(`prints the firm's name legibly through ${branch}`, async () => {
      if (logo) {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              new Response(ONE_PIXEL_PNG, {
                status: 200,
                headers: { 'content-type': 'image/png' },
              }),
          ),
        );
      }
      const out = await buildBrandedDocumentPdf({
        document: BODY,
        title: 'Letter',
        brandName: DESIGN.firmName,
        accent,
        ...input,
      });
      expect(out).not.toBeNull();
      // The banner branch upper-cases the name, so both are matched on a
      // fragment of it rather than on the whole string.
      const nameRuns = drawnInk(out!.bytes).filter((run) =>
        run.text.toUpperCase().includes('HARTLEY AND VANCE'),
      );
      // An empty sweep must not pass: if the extractor stops finding the name,
      // that is a broken test, not a legible document.
      expect(nameRuns.length, 'the firm name was never found in the PDF').toBeGreaterThan(0);
      for (const run of nameRuns) {
        expect(
          contrastRatio(run.colour, '#ffffff'),
          `"${run.text}" is printed in ${run.colour}, which measures ${contrastRatio(run.colour, '#ffffff').toFixed(3)}:1 on white paper`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    });
  }

  it('still paints the accent BAR in the firm\'s exact colour', async () => {
    const out = await buildBrandedDocumentPdf({
      document: BODY,
      title: 'Letter',
      brandName: DESIGN.firmName,
      accent,
      letterheadDesign: DESIGN,
    });
    expect(shapeFillColours(out!.bytes)).toContain(accent.toLowerCase());
  });
});

/* ------------------------------------------------------------------ */
/* The preview cannot say something the document does not.             */
/* ------------------------------------------------------------------ */

describe('the studios preview what the renderer prints', () => {
  const sources = {
    'app/counsel/letters/letters-studio.tsx': readFileSync(
      join(__dirname, '..', 'app/counsel/letters/letters-studio.tsx'),
      'utf8',
    ),
    'app/counsel/templates/template-studio.tsx': readFileSync(
      join(__dirname, '..', 'app/counsel/templates/template-studio.tsx'),
      'utf8',
    ),
  };

  for (const [path, src] of Object.entries(sources)) {
    it(`${path} paints no raw accent as text`, () => {
      // The derivation is stripped out first, so what remains is any raw accent
      // that reaches a `color:` on its own. `\baccent\b` then catches
      // `brand.accent`, `meta.accent` and a bare `accent` prop alike.
      const raw = [...src.matchAll(/color:\s*([^,\n}]+)/g)]
        .map((m) => m[1].trim().replace(/accentTextOnDocument\([^)]*\)/g, ''))
        .filter((value) => /\baccent\b/i.test(value));
      expect(
        raw,
        'an inline `color: <raw accent>` is invisible to every class-based contrast guard',
      ).toEqual([]);
    });

    it(`${path} derives its letterhead text the way the renderer does`, () => {
      expect(src).toContain('accentTextOnDocument');
    });
  }
});
