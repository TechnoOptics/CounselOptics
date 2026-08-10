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

/**
 * The expression assigned at `start`, up to the `,` or `;` that ends it
 * at bracket depth zero. Reading to the end of the line instead would
 * stop inside a multi-line call, and reading a fixed window would run
 * into the next field and blame this one for what that one does.
 */
function valueAt(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      if (depth === 0) return src.slice(start, i);
      depth -= 1;
    } else if (depth === 0 && (c === ',' || c === ';')) {
      return src.slice(start, i);
    }
  }
  return src.slice(start);
}

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

  it('never derives a count from a list it truncated for display', () => {
    // The defect this replaced, twice over. The page handed the tiles a
    // list sliced to ten and the tiles printed that list's LENGTH as the
    // count, so an attorney with 24 matters read "10", the card was
    // headed "20 things in your name" and could never say anything else,
    // and the action center added a capped ten into "N things need a
    // human". A list you truncated and a total are two different values
    // and the page has to compute them separately.
    const fields = [...page.matchAll(/(?:const\s+)?(\w*(?:Total|Count))\s*[:=]\s*/g)]
      .map((m) => [m[0], m[1], valueAt(page, (m.index ?? 0) + m[0].length)] as const)
      // A shorthand reference (`signing: { mineAwaitingCount }`) has no
      // value of its own; the `const` above it is the one that counts.
      .filter(([, , expr]) => expr.trim().length > 0);
    expect(
      fields.length,
      'no total-shaped field found; the sweep has stopped matching',
    ).toBeGreaterThanOrEqual(3);
    /**
     * Truncation one hop away counts too. Reading only the field's own
     * expression saw `casesTotal: myCases.slice(0, 5).length` but not the
     * ordinary refactor that hoists it:
     *
     *     const shownCases = myCases.slice(0, 5);
     *     cases: shownCases.map(...),
     *     casesTotal: shownCases.length,
     *
     * which is the same defect written over two statements and left this
     * green. So every identifier a total is built from is resolved back to
     * its own `const` and that initializer is checked as well.
     *
     * The third spelling is a filter that reads the INDEX:
     * `myCases.filter((_, i) => i < 5).length` is the same defect again, and
     * a plain `.filter(` ban would be wrong because counting a subset is what
     * a total is often made of. So only an index-taking callback counts.
     *
     * This catches truncation spelled as slice, splice, or an index filter,
     * in the expression or one binding away. It is not a proof that no other
     * spelling of "shorten this list" exists.
     */
    const TRUNCATES = /\.slice\(|\.splice\(|\.filter\(\s*\([^)]*,[^)]*\)\s*=>/;
    const bindingOf = (id: string): string | null => {
      const at = page.search(new RegExp(`\\bconst ${id}\\s*=\\s*`));
      if (at === -1) return null;
      const eq = page.indexOf('=', at) + 1;
      return valueAt(page, eq);
    };
    for (const [, name, expr] of fields) {
      expect(
        TRUNCATES.test(expr),
        `${name} is computed from a truncated list: ${expr.trim()}`,
      ).toBe(false);
      for (const id of new Set([...expr.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]))) {
        const bound = bindingOf(id);
        if (bound == null) continue;
        expect(
          TRUNCATES.test(bound),
          `${name} is computed from ${id}, which is a truncated list: ${bound.trim()}`,
        ).toBe(false);
      }
    }
    // And the three that exist are the ones this is about.
    const names = fields.map((f) => f[1]);
    expect(names).toContain('casesTotal');
    expect(names).toContain('clientsTotal');
    expect(names).toContain('mineAwaitingCount');

    // The other half of the same defect: the tile reading the length of
    // the rows it was given rather than the total beside them. Both
    // halves have to hold, because either one alone puts the wrong
    // number on the card.
    const tiles = readFileSync(
      `${root}components/counsel/CounselDashboardTiles.tsx`,
      'utf8',
    );
    for (const wrong of [
      'assigned.cases.length',
      'assigned.clients.length',
      'mineAwaiting.length',
    ]) {
      expect(tiles, `the tile counts ${wrong}`).not.toContain(wrong);
    }
    expect(tiles).toContain('assigned.casesTotal');
    expect(tiles).toContain('assigned.clientsTotal');
    expect(tiles).toContain('signing.mineAwaitingCount');
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
