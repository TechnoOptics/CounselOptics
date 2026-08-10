import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The counsel dashboard's shape, held against its own copy.
 *
 * docs/PARITY-PAGE-RULES.md gives a dashboard one shape: a strip of
 * metric cards across the top, then a grid of cards, with nothing on the
 * page competing with the strip. The "Customize dashboard" control used
 * to sit in a right-aligned row of its own between the two, which broke
 * that in the obvious way and in a less obvious one: three separate
 * pieces of prose already described the control as living in the header.
 * The page's own docblock said so, DashboardCustomizer's docstring said
 * so, and the empty state told the reader to click it "up top" while
 * rendering directly underneath it.
 *
 * This repo has a standing habit of comments that describe a thing that
 * was never wired. The useful guard is therefore not "the button is in
 * the header" on its own - that is a restatement of one line - but the
 * tie between the instruction the user reads and the place the control
 * is actually rendered. If somebody moves the control back, the copy
 * telling people where to find it has to move with it.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const page = readFileSync(`${root}app/counsel/page.tsx`, 'utf8');

/** The span of the `<PageHeader ... />` element, by bracket depth. */
function pageHeaderSpan(src: string): [number, number] {
  const start = src.indexOf('<PageHeader');
  expect(start, 'the dashboard no longer renders a PageHeader').toBeGreaterThan(
    -1,
  );
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    else if (src[i] === '>' && depth === 0 && src[i - 1] === '/') {
      return [start, i];
    }
  }
  throw new Error('unterminated PageHeader element');
}

describe('the counsel dashboard puts its action where its copy says it is', () => {
  const [start, end] = pageHeaderSpan(page);
  const header = page.slice(start, end);
  const body = page.slice(end);

  it('finds both halves of the page, so an empty sweep cannot pass', () => {
    expect(header).toContain('Welcome to');
    expect(body).toContain('DashboardTileRenderer');
  });

  it('renders the customize control exactly once', () => {
    const uses = page.split('<DashboardCustomizer').length - 1;
    expect(uses).toBe(1);
  });

  it('renders it as the header action rather than as a row of its own', () => {
    expect(header).toContain('<DashboardCustomizer');
    expect(body).not.toContain('<DashboardCustomizer');
    // And it is the header's `action`, not loose children under the
    // title, which would put it below the subtitle instead of opposite
    // it.
    expect(/action=\{\s*\n?\s*<DashboardCustomizer/.test(header)).toBe(true);
  });

  it('keeps the empty state pointing at where the control actually is', () => {
    // The copy a reader follows when they have hidden every tile. "up
    // top" is only true while the control is in the header.
    const emptyState = /<EmptyState[\s\S]*?\/>/.exec(body)?.[0] ?? '';
    expect(emptyState, 'the dashboard empty state was not found').toContain(
      'Customize dashboard',
    );
    if (emptyState.includes('up top')) {
      expect(
        header.includes('<DashboardCustomizer'),
        'the empty state says the customize control is "up top", so it has to be in the page header',
      ).toBe(true);
    }
  });

  it('leads with the metric strip, before anything else on the page', () => {
    // "Nothing else on the page competes with the strip." The strip is
    // the first thing after the header; the Ask bar and the tile grid
    // follow it.
    const strip = body.indexOf('<StatCard');
    const ask = body.indexOf('<AskAdvottic');
    const tiles = body.indexOf('<DashboardTileRenderer');
    expect(strip).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(ask);
    expect(ask).toBeLessThan(tiles);
  });
});
