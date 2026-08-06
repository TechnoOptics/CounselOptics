import { describe, it, expect } from 'vitest';
import qrcode from 'qrcode-generator';
import { qrSvg, QR_MIN_QUIET_ZONE } from '../lib/qr-svg';

/**
 * A realistic handoff URL: origin plus the base64url token minted by
 * lib/signing-handoff.ts. This is a live signing credential, which is why
 * the encoder runs here and not at a hosted QR image service.
 */
const TOKEN = '8Kj2vQ9wR4tYbN7xL0aZcE6sD1fG3hJ5kM7nP9qS2uW';
const SIGNING_URL = `https://app.example.com/sign/m/${TOKEN}`;

/** The one path command shape the renderer is allowed to emit. */
const MODULE_COMMAND = /M(\d+) (\d+)h1v1h-1z/g;

function pathData(svg: string): string {
  const match = /<path d="([^"]*)"/.exec(svg);
  expect(match, 'svg has a single module path').not.toBeNull();
  return match![1];
}

/** Every module the SVG actually paints, as "col,row" in viewBox space. */
function paintedModules(svg: string): Set<string> {
  const d = pathData(svg);
  const painted = new Set<string>();
  MODULE_COMMAND.lastIndex = 0;
  for (const m of d.matchAll(MODULE_COMMAND)) {
    painted.add(`${m[1]},${m[2]}`);
  }
  // Nothing but unit squares may be in there. If the renderer ever emitted
  // a command this helper does not understand, the comparisons below would
  // silently pass on a partial reading of the matrix.
  expect(d.replace(MODULE_COMMAND, '')).toBe('');
  return painted;
}

/** The matrix straight from the encoder, in the same coordinate space. */
function encoderModules(text: string, margin: number): Set<string> {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const dark = new Set<string>();
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) dark.add(`${col + margin},${row + margin}`);
    }
  }
  return dark;
}

describe('qrSvg', () => {
  it('emits a self-contained square svg', () => {
    const svg = qrSvg(SIGNING_URL);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('paints exactly the modules the encoder marked dark', () => {
    const svg = qrSvg(SIGNING_URL);
    const modules = /data-modules="(\d+)"/.exec(svg);
    expect(modules).not.toBeNull();

    const expected = encoderModules(SIGNING_URL, QR_MIN_QUIET_ZONE);
    const painted = paintedModules(svg);

    // Set equality, not just size. A renderer that dropped one module and
    // added another somewhere else would pass a count check and fail here.
    expect([...painted].sort()).toEqual([...expected].sort());
    expect(painted.size).toBeGreaterThan(0);
  });

  it('leaves the quiet zone genuinely blank on all four sides', () => {
    const margin = QR_MIN_QUIET_ZONE;
    const svg = qrSvg(SIGNING_URL, { margin });
    const count = Number(/data-modules="(\d+)"/.exec(svg)![1]);
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(viewBox).not.toBeNull();

    // The border a scanner needs is empty space, not merely a bigger box.
    // Assert on the painted modules, because a viewBox that grew while the
    // matrix stayed at the origin would leave one edge with no quiet zone.
    const total = Number(viewBox![1]);
    expect(total).toBe(count + margin * 2);
    expect(Number(viewBox![2])).toBe(total);

    for (const key of paintedModules(svg)) {
      const [col, row] = key.split(',').map(Number);
      expect(col).toBeGreaterThanOrEqual(margin);
      expect(row).toBeGreaterThanOrEqual(margin);
      expect(col).toBeLessThan(margin + count);
      expect(row).toBeLessThan(margin + count);
    }
  });

  it('honours a wider quiet zone than the default', () => {
    const svg = qrSvg(SIGNING_URL, { margin: 6 });
    const count = Number(/data-modules="(\d+)"/.exec(svg)![1]);
    expect(svg).toContain(`viewBox="0 0 ${count + 12} ${count + 12}"`);
    expect(paintedModules(svg)).toEqual(encoderModules(SIGNING_URL, 6));
  });

  it('refuses a quiet zone too narrow for a scanner to find the code', () => {
    expect(() => qrSvg(SIGNING_URL, { margin: QR_MIN_QUIET_ZONE - 1 })).toThrow(
      /quiet zone/i,
    );
    expect(() => qrSvg(SIGNING_URL, { margin: 0 })).toThrow(/quiet zone/i);
    // A fractional margin would offset every module off the module grid.
    expect(() => qrSvg(SIGNING_URL, { margin: 4.5 })).toThrow(/quiet zone/i);
  });

  it('refuses a size that would not render', () => {
    expect(() => qrSvg(SIGNING_URL, { size: 0 })).toThrow(/size/i);
    expect(() => qrSvg(SIGNING_URL, { size: -240 })).toThrow(/size/i);
    expect(() => qrSvg(SIGNING_URL, { size: Number.NaN })).toThrow(/size/i);
    expect(qrSvg(SIGNING_URL, { size: 240 })).toContain(
      'width="240" height="240"',
    );
  });

  it('omits width and height when no size is asked for', () => {
    // Scoped to the opening tag, because the background rect carries its own
    // width and height and always will.
    const openTag = /^<svg[^>]*>/.exec(qrSvg(SIGNING_URL))![0];
    expect(openTag).not.toContain('width=');
    expect(openTag).not.toContain('height=');
    expect(/^<svg[^>]*>/.exec(qrSvg(SIGNING_URL, { size: 240 }))![0]).toContain(
      'width="240" height="240"',
    );
  });

  it('encodes different text differently', () => {
    expect(qrSvg('one')).not.toBe(qrSvg('two'));
  });

  it('is deterministic for the same text', () => {
    expect(qrSvg('same')).toBe(qrSvg('same'));
  });

  it('reaches no network and embeds no external reference', () => {
    const svg = qrSvg(SIGNING_URL);
    // The xmlns is a namespace identifier, never fetched, and it is the one
    // http:// the markup is allowed to carry.
    const withoutNamespace = svg.replace(
      'xmlns="http://www.w3.org/2000/svg"',
      '',
    );
    expect(withoutNamespace).not.toContain('http://');
    expect(withoutNamespace).not.toContain('https://');
    expect(svg).not.toMatch(/<image\b/);
    expect(svg).not.toMatch(/<script\b/i);
    expect(svg).not.toMatch(/<foreignObject\b/i);
    expect(svg).not.toMatch(/<use\b/);
    expect(svg).not.toMatch(/xlink:href/);
    expect(svg).not.toMatch(/\bhref=/);
    expect(svg).not.toMatch(/url\(/);
    expect(svg).not.toMatch(/@import/);
  });

  it('never writes the encoded credential into the markup', () => {
    const svg = qrSvg(SIGNING_URL);
    // The token lives in the module matrix and nowhere else. Anything that
    // put it in a label or a title would leak it to a screen reader, to
    // copied markup and to any DOM-scraping extension on the page.
    expect(svg).not.toContain(TOKEN);
    expect(svg).not.toContain('app.example.com');
  });

  it('refuses empty text rather than emitting an unscannable code', () => {
    expect(() => qrSvg('')).toThrow();
    expect(() => qrSvg('   ')).toThrow();
  });

  it('still encodes a url near the capacity boundary', () => {
    // Byte mode at error correction M tops out around 2300 characters.
    // A handoff URL is nowhere near this, but a renderer that hard-coded a
    // small version number would silently fail on a long deployment origin,
    // so hold the line where the library actually places it.
    const long = `https://app.example.com/sign/m/${'a'.repeat(2200)}`;
    const svg = qrSvg(long);
    const count = Number(/data-modules="(\d+)"/.exec(svg)![1]);
    expect(count).toBeGreaterThan(100);
    expect(paintedModules(svg)).toEqual(
      encoderModules(long, QR_MIN_QUIET_ZONE),
    );
  });

  it('throws rather than truncating text that cannot fit', () => {
    expect(() => qrSvg('a'.repeat(5000))).toThrow();
  });
});
