import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DASH,
  REPORT_WINDOW_DAYS,
  REPORT_WEEKS,
  buildMyTiles,
  buildReportTiles,
  formatShare,
  rankBars,
  type Figure,
} from '../lib/counsel-reports';
import { DEFAULT_MENU } from '../lib/menu-config';

/**
 * /counsel/reports and /counsel/my state twenty-odd figures between them,
 * and every one of them is a COUNT of a whole set.
 *
 * The two failures this file exists to catch are the two this product has
 * already shipped elsewhere and paid for:
 *
 *   1. A FLOOR WEARING A TOTAL'S LABEL. A figure taken as `.length` over a
 *      read that was capped, sliced, or paginated. The dashboard shipped it
 *      twice (intake lanes over a 200-row read, signing chase-ups over a
 *      list sliced to ten), and an audit found a trust aggregate that was a
 *      floor over a 20000-row read.
 *   2. A NUMBER THE PRODUCT CANNOT ACTUALLY COMPUTE. A zero printed where
 *      the truth is "we could not read this", or a rate invented out of an
 *      empty denominator.
 *
 * Part 1 holds the shaping, which is pure and can be exercised directly.
 * Part 2 holds the READS, by scanning lib/counsel-reports-data.ts: a
 * property about the shape of a query cannot be asserted any other way
 * without a database, and this repo has settled on the source-text form
 * (tests/dashboard-counts-are-counts.test.ts is the same idiom).
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const dataModule = readFileSync(`${root}lib/counsel-reports-data.ts`, 'utf8');
const reportsPage = readFileSync(`${root}app/counsel/reports/page.tsx`, 'utf8');
const myPage = readFileSync(`${root}app/counsel/my/page.tsx`, 'utf8');

const byId = (figures: Figure[], id: string): Figure => {
  const f = figures.find((x) => x.id === id);
  if (!f) throw new Error(`no figure ${id}; got ${figures.map((x) => x.id).join(', ')}`);
  return f;
};

/** A complete, all-real set of firm figures. Nothing null, nothing hidden. */
const FIRM = {
  requestsReceivedInWindow: 41,
  requestsNeedingAttention: 6,
  approvalsWaiting: 3,
  documentsOverdue: 2,
  signingSentInWindow: 20,
  signingCompletedInWindow: 13,
  mattersOpenedInWindow: 9,
} as const;

const ME = {
  myOpenMatters: 7,
  myOpenRequests: 5,
  myRequestsNeedingAttention: 2,
  firmOpenRequests: 20,
  mySignaturesOut: 4,
  myApprovalDecisionsInWindow: 11,
  myTimeEntriesInWindow: 30,
} as const;

// ---------------------------------------------------------------------------
// Part 1: the shaping
// ---------------------------------------------------------------------------

describe('a share is stated only when both halves of it are real', () => {
  it('states the share when the denominator holds something', () => {
    expect(formatShare(13, 20)).toBe('65%');
  });

  it('has no share to state when nothing has happened in the window', () => {
    // THE POINT OF THE WHOLE FILE. 0/0 is not 0%: a firm that sent no
    // signature requests this month has no completion rate, and printing
    // "0%" tells its partners their signing collapsed.
    expect(formatShare(0, 0)).toBeNull();
  });

  it('has no share to state when either half could not be read', () => {
    expect(formatShare(null, 20)).toBeNull();
    expect(formatShare(13, null)).toBeNull();
  });

  it('never rounds a real numerator away to nothing', () => {
    // 1 in 400 rounds to 0%, and "0%" beside a caption saying one landed
    // is a contradiction on the page. It reads as under one percent, which
    // is what it is.
    expect(formatShare(1, 400)).toBe('<1%');
    expect(formatShare(0, 400)).toBe('0%');
  });

  it('never rounds an incomplete share up to the whole', () => {
    expect(formatShare(399, 400)).toBe('>99%');
    expect(formatShare(400, 400)).toBe('100%');
  });
});

describe('a figure with nothing behind it shows a dash, not a zero', () => {
  const tiles = buildReportTiles(
    { ...FIRM, signingSentInWindow: 0, signingCompletedInWindow: 0 },
    { canReadMatterMaterial: true },
  );

  it('draws the dash in place of the number', () => {
    expect(byId(tiles, 'signing-completion').display).toBe(DASH);
    expect(byId(tiles, 'signing-completion').value).toBeNull();
  });

  it('keeps the caption, so the tile still says what it measures', () => {
    expect(byId(tiles, 'signing-completion').caption.trim().length).toBeGreaterThan(0);
  });

  it('keeps the tile, rather than hiding a metric the firm has', () => {
    expect(tiles.map((t) => t.id)).toContain('signing-completion');
  });

  it('keeps the dash in the metric own tone, not a neutral one', () => {
    // A rate is accent-toned whether or not it has a value this month.
    expect(byId(tiles, 'signing-completion').tone).toBe('rate');
  });
});

describe('a count that could not be read is a dash, never a zero', () => {
  const tiles = buildReportTiles(
    { ...FIRM, approvalsWaiting: null },
    { canReadMatterMaterial: true },
  );

  it('does not print a zero it cannot justify', () => {
    expect(byId(tiles, 'approvals-waiting').display).toBe(DASH);
  });

  it('does not read as the healthy state either', () => {
    // A real zero here is "queue clear" and reads plain. An unread figure
    // must not borrow that reassurance.
    expect(byId(tiles, 'approvals-waiting').value).toBeNull();
  });
});

describe('an attention figure is red only when something is actually waiting', () => {
  it('reads urgent above zero', () => {
    const tiles = buildReportTiles(FIRM, { canReadMatterMaterial: true });
    expect(byId(tiles, 'requests-attention').tone).toBe('urgent');
    expect(byId(tiles, 'approvals-waiting').tone).toBe('urgent');
    expect(byId(tiles, 'documents-overdue').tone).toBe('urgent');
  });

  it('reads plain at zero, because a clear queue is not a warning', () => {
    const tiles = buildReportTiles(
      { ...FIRM, requestsNeedingAttention: 0, approvalsWaiting: 0, documentsOverdue: 0 },
      { canReadMatterMaterial: true },
    );
    expect(byId(tiles, 'requests-attention').tone).toBe('plain');
    expect(byId(tiles, 'approvals-waiting').tone).toBe('plain');
    expect(byId(tiles, 'documents-overdue').tone).toBe('plain');
  });

  it('leaves a plain count plain at every value', () => {
    const tiles = buildReportTiles(FIRM, { canReadMatterMaterial: true });
    expect(byId(tiles, 'requests-received').tone).toBe('plain');
    expect(byId(tiles, 'matters-opened').tone).toBe('plain');
  });
});

describe('a reader whose role cannot read a table gets no tile for it', () => {
  const tiles = buildReportTiles(FIRM, { canReadMatterMaterial: false });
  const ids = tiles.map((t) => t.id);

  it('omits the matter figure rather than showing it as zero', () => {
    // `cases` and `firm_documents` refuse a `staff` member under the
    // applied 20260731_staff_role_read_scope migration, and a refused
    // select comes back empty with no error. A zero here would be a
    // fabricated figure, and a dash would claim the firm opened no
    // matters. The only true rendering is no tile.
    expect(ids).not.toContain('matters-opened');
    expect(ids).not.toContain('documents-overdue');
  });

  it('keeps every figure the reader can actually read', () => {
    expect(ids).toContain('requests-received');
    expect(ids).toContain('requests-attention');
    expect(ids).toContain('approvals-waiting');
    expect(ids).toContain('signing-completion');
  });

  it('gives the same reader the same tiles on the personal page', () => {
    const mine = buildMyTiles(ME, { canReadMatterMaterial: false }).map((t) => t.id);
    expect(mine).not.toContain('my-matters');
    expect(mine).toContain('my-requests');
  });
});

describe('every windowed figure carries its window in its own label', () => {
  const windowed = new Set([
    'requests-received',
    'matters-opened',
    'signing-completion',
    'my-approval-decisions',
    'my-time-entries',
  ]);
  const all = [
    ...buildReportTiles(FIRM, { canReadMatterMaterial: true }),
    ...buildMyTiles(ME, { canReadMatterMaterial: true }),
  ];

  it('finds the figures at all, so an empty sweep cannot pass', () => {
    expect(all.length).toBeGreaterThanOrEqual(12);
  });

  it('puts the qualifier after a middle dot on every windowed figure', () => {
    for (const f of all.filter((x) => windowed.has(x.id))) {
      expect(f.label, `${f.id} states no window`).toContain(' · ');
      expect(f.label).toContain(String(REPORT_WINDOW_DAYS));
    }
  });

  it('leaves a figure that is true right now unqualified', () => {
    // "Approvals waiting" is a standing total, not a window. A middle-dot
    // qualifier on it would name a period the number is not taken over.
    expect(byId(all, 'approvals-waiting').label).not.toContain(' · ');
    expect(byId(all, 'requests-attention').label).not.toContain(' · ');
  });
});

describe('the personal page states a share of a real denominator', () => {
  it('states my share of the open queue', () => {
    const tiles = buildMyTiles(ME, { canReadMatterMaterial: true });
    expect(byId(tiles, 'my-queue-share').display).toBe('25%');
    expect(byId(tiles, 'my-queue-share').tone).toBe('rate');
  });

  it('has no share to state when the firm has nothing open', () => {
    const tiles = buildMyTiles(
      { ...ME, myOpenRequests: 0, firmOpenRequests: 0 },
      { canReadMatterMaterial: true },
    );
    expect(byId(tiles, 'my-queue-share').display).toBe(DASH);
  });
});

describe('a ranked bar chart is ranked and proportioned to its own total', () => {
  it('puts the heaviest first and scales every bar to it', () => {
    const bars = rankBars([
      { key: 'a', label: 'A', count: 2 },
      { key: 'b', label: 'B', count: 8 },
      { key: 'c', label: 'C', count: 0 },
    ]);
    expect(bars.map((b) => b.key)).toEqual(['b', 'a', 'c']);
    expect(bars.map((b) => b.pct)).toEqual([100, 25, 0]);
  });

  it('draws no bar at all when nothing has been counted', () => {
    // Not a full-width bar each: dividing by a zero maximum used to give
    // every empty category a 100% bar, which reads as a busy firm.
    const bars = rankBars([
      { key: 'a', label: 'A', count: 0 },
      { key: 'b', label: 'B', count: 0 },
    ]);
    expect(bars.map((b) => b.pct)).toEqual([0, 0]);
  });

  it('carries an unreadable count through as a dash rather than a zero bar', () => {
    const bars = rankBars([{ key: 'a', label: 'A', count: null }]);
    expect(bars[0].display).toBe(DASH);
    expect(bars[0].pct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Part 2: the reads
// ---------------------------------------------------------------------------

/**
 * Each `.from('...')` call in a module and the query chained onto it.
 *
 * A chain runs to the NEXT `.from(` rather than to the next blank line:
 * these queries sit one per entry inside a `Promise.all([...])` array, so
 * there are no blank lines between them and a blank-line split would hand
 * every assertion the whole array and pass on the first query's text.
 */
function queries(src: string): Array<{ table: string; chain: string }> {
  const starts: Array<{ table: string; at: number }> = [];
  const re = /\.from\('([a-z_]+)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ table: m[1], at: m.index });
  return starts.map((s, i) => {
    const upTo = src.slice(s.at, starts[i + 1]?.at ?? src.length);
    // A chain also ends where its Promise.all array closes, so the LAST
    // query in an array does not swallow the code that follows it.
    const close = upTo.indexOf('\n  ]);');
    return { table: s.table, chain: close === -1 ? upTo : upTo.slice(0, close) };
  });
}

describe('every figure these pages state is counted by the database', () => {
  const all = queries(dataModule);

  it('finds the reads at all, so an empty sweep cannot pass', () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
  });

  it('asks for an exact count everywhere it is not reading rows to draw', () => {
    const totals = all.filter((q) => !q.chain.includes('.limit('));
    expect(totals.length).toBeGreaterThanOrEqual(18);
    for (const q of totals) {
      expect(q.chain, `a total read of ${q.table} without an exact count`).toContain(
        "count: 'exact'",
      );
      expect(q.chain, `a total read of ${q.table} that fetches rows`).toContain(
        'head: true',
      );
    }
  });

  it('bounds only the reads that are lists of rows somebody looks at', () => {
    const bounded = all.filter((q) => q.chain.includes('.limit('));
    expect(bounded.length).toBeGreaterThanOrEqual(2);
    for (const q of bounded) {
      // A bounded read must never also be counting: that is the exact
      // shape of a floor wearing a total's label.
      expect(q.chain, `${q.table} is both bounded and counted`).not.toContain(
        "count: 'exact'",
      );
      // And it must be selecting the columns a row is drawn from, rather
      // than a bare id somebody is about to take the length of.
      expect(
        /\.select\(\s*'[^']*,/.test(q.chain),
        `the bounded read of ${q.table} selects no display columns, so it looks like a tally`,
      ).toBe(true);
    }
  });

  it('never turns a read into a figure in JavaScript', () => {
    // Every floor this product has shipped was written with one of these
    // three. A tally of rows cannot be expressed without a `.length` or a
    // `.reduce`, and a cap that hides inside a total is a `.slice`. The
    // module has none of them, and none of them has any other use here:
    // the figures arrive as numbers and are passed through as numbers.
    expect(dataModule).not.toMatch(/\.length/);
    expect(dataModule).not.toMatch(/\.reduce\(/);
    expect(dataModule).not.toMatch(/\.slice\(/);
  });

  it('takes every count off the count field and nowhere else', () => {
    // `count: 'exact', head: true` returns no rows at all, so a figure can
    // only come from `.count`. Pinning the arithmetic-free path means a
    // later `.filter(...).length` over the same query goes red here.
    const counts = dataModule.match(/\.count\s*\?\?\s*null/g) ?? [];
    expect(counts.length).toBeGreaterThanOrEqual(18);
  });
});

describe('both pages ask the role question before they ask the database', () => {
  for (const [name, src] of [
    ['reports', reportsPage],
    ['my', myPage],
  ] as const) {
    it(`${name} decides what a role may read from the one predicate`, () => {
      // Not a role list of its own. canReadMatterMaterial reads
      // FIRM_POSTING_ROLES, which is the set the applied RLS migration
      // names, so the page gate and the database gate cannot drift.
      expect(src).toContain('canReadMatterMaterial');
      expect(src).not.toContain("'staff'");
    });
  }
});

describe('both pages are localized and both mark firm data as data', () => {
  for (const [name, src] of [
    ['reports', reportsPage],
    ['my', myPage],
  ] as const) {
    it(`${name} imports the counsel translator`, () => {
      expect(src).toContain("from '@/components/i18n/LocaleProvider'");
    });

    it(`${name} keeps firm data out of the translation engine`, () => {
      expect(src).toContain('data-no-translate');
    });
  }
});

describe('both pages are on the rail, in the group the reference puts them in', () => {
  const overview = DEFAULT_MENU[0];

  it('leads the rail with the overview group', () => {
    expect(overview.section).toBe('Overview');
  });

  it('carries reports and the personal page in it', () => {
    const hrefs = overview.items.map((i) => i.href);
    expect(hrefs).toContain('/counsel/reports');
    expect(hrefs).toContain('/counsel/my');
  });

  it('puts them directly under the dashboard, above the working sections', () => {
    const hrefs = overview.items.map((i) => i.href);
    expect(hrefs.slice(0, 3)).toEqual(['/counsel', '/counsel/reports', '/counsel/my']);
  });
});

describe('the window a figure names is the window the query asks for', () => {
  it('derives every window from one constant', () => {
    expect(REPORT_WINDOW_DAYS).toBe(30);
    expect(REPORT_WEEKS).toBe(12);
    // A second spelling of "30 days" in the data module is how a label and
    // its query come apart. The module has to reach for the constant.
    expect(dataModule).toContain('REPORT_WINDOW_DAYS');
    expect(dataModule).toContain('REPORT_WEEKS');
    expect(dataModule).not.toMatch(/\b30\s*\*\s*24\s*\*/);
  });
});
