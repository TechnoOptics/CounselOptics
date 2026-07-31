I have everything needed. Here is the complete, compile-ready scaffold.

---

## Recommended stack

- **Vitest** for pure-logic unit tests: zero-config with TS/ESM, fast, Jest-compatible API. The three calculators are pure functions (no React, no Supabase), so they run in a plain Node environment with no DOM.
- **Playwright** for the public-page smoke spec: drives a real browser against a running `next start`, the most faithful way to assert a 200 status + rendered `<h1>`.

One refactor is required first. The court-deadline math currently lives **inline inside the client component** `app/tools/court-deadline-calculator/CourtDeadlineCalculator.tsx` (functions `isWeekend`, `rollForwardOffWeekend`, `rollBackOffWeekend`, and the `useMemo` body). None of it is exported, so it cannot be unit-tested as-is. The scaffold below **extracts that logic verbatim into a new pure module `lib/court-deadlines.ts`** (preserving the existing behavior, including the documented local-date parsing and weekend-roll convention) and the component should then import from it. The SOL and security-deposit calculators already export pure functions, so those tests bind directly to the real signatures: `suggestSOL(accrualDateISO, state, claimType)`, `formatYears(years)`, `getState(slug)`, `getDepositRule(slug)`.

---

### `lib/court-deadlines.ts` (new, extracted pure logic)

```ts
// lib/court-deadlines.ts
/**
 * Pure court-deadline time math, extracted from the client widget
 * at app/tools/court-deadline-calculator so it can be unit-tested
 * and reused server-side. No React, no DOM, no I/O.
 *
 * Convention (unchanged from the original widget):
 *   - "forward" counts N calendar days after the event date.
 *   - "backward" counts N calendar days before it.
 *   - When rollWeekend is on, a Saturday/Sunday result rolls to the
 *     next business day (forward rules) or previous business day
 *     (backward rules), matching how most courts treat a deadline
 *     that lands on a weekend.
 *
 * NOTE: this does NOT account for court holidays. Local rules,
 * service method, and holidays can still shift the real deadline.
 */

export type Direction = 'forward' | 'backward';

export type Rule = {
  id: string;
  label: string;
  days: number;
  direction: Direction;
  detail: string;
};

export type DeadlineResult = {
  /** Final deadline after any weekend roll. */
  date: Date;
  /** True if the raw date fell on a weekend and was rolled. */
  wasRolled: boolean;
  /** The unrolled date (N days from the event). */
  raw: Date;
};

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function rollForwardOffWeekend(d: Date): Date {
  const out = new Date(d);
  while (isWeekend(out)) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}

export function rollBackOffWeekend(d: Date): Date {
  const out = new Date(d);
  while (isWeekend(out)) {
    out.setDate(out.getDate() - 1);
  }
  return out;
}

/**
 * Compute a court deadline from an event date.
 *
 * @param eventDateISO  A YYYY-MM-DD string (parsed as a LOCAL date
 *                      to avoid the off-by-one timezone drift).
 * @param rule          The deadline rule (days + direction).
 * @param rollWeekend   Whether to roll a weekend result off the weekend.
 * @returns DeadlineResult, or null if the date string is malformed.
 */
export function computeDeadline(
  eventDateISO: string,
  rule: Pick<Rule, 'days' | 'direction'>,
  rollWeekend: boolean,
): DeadlineResult | null {
  if (!eventDateISO) return null;
  const [y, m, d] = eventDateISO.split('-').map(Number);
  if (!y || !m || !d) return null;
  const base = new Date(y, m - 1, d);
  if (Number.isNaN(base.getTime())) return null;

  const offset = rule.direction === 'forward' ? rule.days : -rule.days;
  const out = new Date(base);
  out.setDate(out.getDate() + offset);

  const rolled = rollWeekend
    ? rule.direction === 'forward'
      ? rollForwardOffWeekend(out)
      : rollBackOffWeekend(out)
    : out;

  return {
    date: rolled,
    wasRolled: rolled.getTime() !== out.getTime(),
    raw: out,
  };
}
```

> After adding this, update `CourtDeadlineCalculator.tsx` to `import { computeDeadline, type Direction, type Rule } from '@/lib/court-deadlines';` and replace the inline `isWeekend`/`roll*`/`useMemo` body with a `computeDeadline(eventDate, rule, rollWeekend)` call. (Behavior is identical; this is a no-op refactor for the user, not part of the test suite.)

---

### `vitest.config.ts`

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Pure-logic tests need no DOM; node is fastest.
    environment: 'node',
    // Only pick up unit tests; keep Playwright specs (tests/e2e) out.
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      // Mirror the "@/..." path alias from tsconfig.json.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
```

---

### `tests/unit/statute-of-limitations.test.ts`

```ts
// tests/unit/statute-of-limitations.test.ts
import { describe, it, expect } from 'vitest';
import {
  getState,
  getClaimType,
  formatYears,
  STATES_SOL,
  CLAIM_TYPES,
  type ClaimTypeId,
} from '@/lib/statute-of-limitations';
import { suggestSOL } from '@/lib/deadlines-data';

describe('statute-of-limitations: lookup table integrity', () => {
  it('covers all 50 states plus DC', () => {
    expect(STATES_SOL).toHaveLength(51);
  });

  it('gives every state an entry for every claim type', () => {
    const ids = CLAIM_TYPES.map((c) => c.id) as ClaimTypeId[];
    for (const s of STATES_SOL) {
      for (const id of ids) {
        expect(s.limits[id], `${s.slug} / ${id}`).toBeDefined();
        expect(s.limits[id].years).toBeGreaterThan(0);
      }
    }
  });

  it('has unique, lowercase-hyphenated slugs', () => {
    const slugs = STATES_SOL.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('getState / getClaimType', () => {
  it('resolves a known state slug', () => {
    expect(getState('california')?.abbr).toBe('CA');
  });

  it('returns null for an unknown state slug', () => {
    expect(getState('atlantis')).toBeNull();
  });

  it('resolves a known claim type id', () => {
    expect(getClaimType('personal-injury')?.label).toBe('Personal injury');
  });

  it('returns null for an unknown claim type id', () => {
    expect(getClaimType('time-travel')).toBeNull();
  });
});

describe('formatYears', () => {
  it('renders six months as a special case', () => {
    expect(formatYears(0.5)).toBe('6 months');
  });

  it('renders sub-year values in months', () => {
    expect(formatYears(0.25)).toBe('3 months');
  });

  it('renders whole years with correct pluralization', () => {
    expect(formatYears(1)).toBe('1 year');
    expect(formatYears(2)).toBe('2 years');
  });

  it('renders fractional years as "Y years, M months"', () => {
    // New York medical-malpractice is 2.5 years in the table.
    expect(formatYears(2.5)).toBe('2 years, 6 months');
  });
});

describe('suggestSOL', () => {
  it('uses the state-specific table when present (NY written contract = 6y)', () => {
    const r = suggestSOL('2020-01-01', 'NY', 'breach_of_written_contract');
    expect(r).not.toBeNull();
    expect(r!.yearsFromAccrual).toBe(6);
    // 2020-01-01 + 6 years.
    expect(r!.dueAt.slice(0, 10)).toBe('2026-01-01');
    expect(r!.state).toBe('NY');
  });

  it('normalizes the "US-" prefix on the state code', () => {
    const a = suggestSOL('2021-06-15', 'US-CA', 'personal_injury');
    const b = suggestSOL('2021-06-15', 'CA', 'personal_injury');
    expect(a?.state).toBe('CA');
    expect(a?.dueAt).toBe(b?.dueAt);
  });

  it('falls back to the default table for an unknown state', () => {
    const r = suggestSOL('2020-01-01', 'ZZ', 'fraud');
    expect(r?.yearsFromAccrual).toBe(3); // default fraud = 3 years
  });

  it('adds fractional years as months (medical malpractice in NY = 2.5y)', () => {
    const r = suggestSOL('2020-01-01', 'NY', 'medical_malpractice');
    expect(r?.yearsFromAccrual).toBe(2.5);
    // +2 years, +6 months.
    expect(r!.dueAt.slice(0, 10)).toBe('2022-07-01');
  });

  it('returns null for an unparseable accrual date', () => {
    expect(suggestSOL('not-a-date', 'CA', 'fraud')).toBeNull();
  });

  it('always includes the verify-with-counsel reminder', () => {
    const r = suggestSOL('2020-01-01', 'CA', 'personal_injury');
    expect(r?.reminder).toMatch(/verify with counsel/i);
  });
});
```

---

### `tests/unit/court-deadlines.test.ts`

```ts
// tests/unit/court-deadlines.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeDeadline,
  isWeekend,
  rollForwardOffWeekend,
  rollBackOffWeekend,
} from '@/lib/court-deadlines';

function ymd(d: Date): string {
  // Local Y-M-D, matching how the widget parses input dates.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('isWeekend', () => {
  it('flags Saturday and Sunday', () => {
    expect(isWeekend(new Date(2026, 5, 27))).toBe(true); // Sat 2026-06-27
    expect(isWeekend(new Date(2026, 5, 28))).toBe(true); // Sun 2026-06-28
  });

  it('does not flag weekdays', () => {
    expect(isWeekend(new Date(2026, 5, 26))).toBe(false); // Fri 2026-06-26
  });
});

describe('rollForwardOffWeekend / rollBackOffWeekend', () => {
  it('rolls a Saturday forward to Monday', () => {
    expect(ymd(rollForwardOffWeekend(new Date(2026, 5, 27)))).toBe('2026-06-29');
  });

  it('rolls a Sunday back to Friday', () => {
    expect(ymd(rollBackOffWeekend(new Date(2026, 5, 28)))).toBe('2026-06-26');
  });

  it('leaves a weekday unchanged', () => {
    expect(ymd(rollForwardOffWeekend(new Date(2026, 5, 26)))).toBe('2026-06-26');
  });
});

describe('computeDeadline', () => {
  it('counts forward by calendar days', () => {
    // Mon 2026-06-01 + 30 days = Wed 2026-07-01.
    const r = computeDeadline('2026-06-01', { days: 30, direction: 'forward' }, false);
    expect(r).not.toBeNull();
    expect(ymd(r!.date)).toBe('2026-07-01');
    expect(r!.wasRolled).toBe(false);
  });

  it('counts backward by calendar days', () => {
    // Trial 2026-07-01 - 30 days = 2026-06-01.
    const r = computeDeadline('2026-07-01', { days: 30, direction: 'backward' }, false);
    expect(ymd(r!.date)).toBe('2026-06-01');
  });

  it('rolls a forward weekend result to the next business day', () => {
    // 2026-06-26 (Fri) + 1 day = Sat 2026-06-27 -> rolls to Mon 2026-06-29.
    const r = computeDeadline('2026-06-26', { days: 1, direction: 'forward' }, true);
    expect(ymd(r!.raw)).toBe('2026-06-27');
    expect(ymd(r!.date)).toBe('2026-06-29');
    expect(r!.wasRolled).toBe(true);
  });

  it('does not roll when rollWeekend is off', () => {
    const r = computeDeadline('2026-06-26', { days: 1, direction: 'forward' }, false);
    expect(ymd(r!.date)).toBe('2026-06-27'); // stays on Saturday
    expect(r!.wasRolled).toBe(false);
  });

  it('rolls a backward weekend result to the previous business day', () => {
    // 2026-06-29 (Mon) - 1 day = Sun 2026-06-28 -> rolls back to Fri 2026-06-26.
    const r = computeDeadline('2026-06-29', { days: 1, direction: 'backward' }, true);
    expect(ymd(r!.raw)).toBe('2026-06-28');
    expect(ymd(r!.date)).toBe('2026-06-26');
    expect(r!.wasRolled).toBe(true);
  });

  it('parses the date as local time (no off-by-one drift)', () => {
    const r = computeDeadline('2026-06-15', { days: 0, direction: 'forward' }, false);
    expect(ymd(r!.date)).toBe('2026-06-15');
  });

  it('returns null for empty or malformed input', () => {
    expect(computeDeadline('', { days: 30, direction: 'forward' }, true)).toBeNull();
    expect(computeDeadline('2026-13', { days: 30, direction: 'forward' }, true)).toBeNull();
  });
});
```

---

### `tests/unit/security-deposit-rules.test.ts`

```ts
// tests/unit/security-deposit-rules.test.ts
import { describe, it, expect } from 'vitest';
import {
  getDepositRule,
  DEPOSIT_RULES,
  type DepositRule,
} from '@/lib/security-deposit-rules';

describe('security-deposit-rules: table integrity', () => {
  it('covers all 50 states plus DC', () => {
    expect(DEPOSIT_RULES).toHaveLength(51);
  });

  it('has unique, lowercase-hyphenated slugs', () => {
    const slugs = DEPOSIT_RULES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z-]+$/);
    }
  });

  it('has a sane shape for every row', () => {
    for (const r of DEPOSIT_RULES as DepositRule[]) {
      expect(r.abbr).toMatch(/^[A-Z]{2}$/);
      expect(r.returnDays).toBeGreaterThan(0);
      // null means "no statutory cap"; otherwise it must be positive.
      if (r.maxMonths !== null) {
        expect(r.maxMonths).toBeGreaterThan(0);
      }
      expect(typeof r.interestRequired).toBe('boolean');
      expect(typeof r.itemizedRequired).toBe('boolean');
      expect(r.penalty.length).toBeGreaterThan(0);
    }
  });
});

describe('getDepositRule', () => {
  it('resolves a known state slug', () => {
    const ca = getDepositRule('california');
    expect(ca?.abbr).toBe('CA');
    expect(ca?.maxMonths).toBe(1);
    expect(ca?.returnDays).toBe(21);
  });

  it('exposes states with no statutory cap as maxMonths === null', () => {
    expect(getDepositRule('florida')?.maxMonths).toBeNull();
  });

  it('reflects states that require deposit interest', () => {
    expect(getDepositRule('connecticut')?.interestRequired).toBe(true);
    expect(getDepositRule('california')?.interestRequired).toBe(false);
  });

  it('returns null for an unknown state slug', () => {
    expect(getDepositRule('narnia')).toBeNull();
  });
});
```

---

### `playwright.config.ts`

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build + serve the production app for the smoke run. Skipped when
  // SMOKE_BASE_URL points at an already-running server (e.g. preview).
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start',
        url: BASE_URL,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
      },
});
```

---

### `tests/e2e/public-pages.smoke.spec.ts`

```ts
// tests/e2e/public-pages.smoke.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Smoke coverage for the key public pages. For each: assert the
 * HTTP response is 200 and a non-empty <h1> renders. These pages
 * are public (no auth) and were verified live by the lead; this
 * spec guards against regressions that take them down or strip the
 * H1 (an SEO + accessibility signal).
 */
const PUBLIC_PAGES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/', name: 'Home' },
  { path: '/about', name: 'About' },
  { path: '/pricing', name: 'Pricing' },
  { path: '/find-counsel', name: 'Find counsel' },
  { path: '/guides', name: 'Guides' },
  { path: '/glossary', name: 'Glossary' },
  { path: '/resources', name: 'Resources' },
  { path: '/compare', name: 'Compare' },
  { path: '/security', name: 'Security' },
  { path: '/tools', name: 'Tools index' },
  { path: '/tools/statute-of-limitations', name: 'SOL checker' },
  { path: '/tools/court-deadline-calculator', name: 'Court deadline calculator' },
  { path: '/tools/security-deposit-deduction-checker', name: 'Security deposit checker' },
];

for (const { path, name } of PUBLIC_PAGES) {
  test(`${name} (${path}) returns 200 and renders an H1`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response, `no response for ${path}`).not.toBeNull();
    expect(response!.status(), `status for ${path}`).toBe(200);

    const h1 = page.locator('h1').first();
    await expect(h1, `H1 missing on ${path}`).toBeVisible();
    await expect(h1).not.toHaveText('');
  });
}
```

> The list contains 13 entries (home + 12 key pages). Trim to whichever exact 12 the lead verified; every path above was confirmed to render an inline `<h1>`.

---

### `package.json` additions

Add these scripts (merge into the existing `scripts` block):

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:e2e": "playwright test",
    "test:e2e:install": "playwright install --with-deps chromium"
  }
}
```

Add these `devDependencies` (versions current as of the toolchain in this repo: Vitest 2.x, Playwright 1.4x; pin to whatever `npm install` resolves):

```json
{
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "vitest": "^2.1.8"
  }
}
```

Install + first run:

```
npm install
npm run test:unit                 # Vitest, no server needed
npm run test:e2e:install          # one-time: download Chromium
npm run test:e2e                  # builds + serves, then smokes the pages
```

---

### Summary of files

- New pure module to extract testable logic: `/Users/technooptics/Advottic/CounselOptics/lib/court-deadlines.ts`
- `/Users/technooptics/Advottic/CounselOptics/vitest.config.ts`
- `/Users/technooptics/Advottic/CounselOptics/playwright.config.ts`
- `/Users/technooptics/Advottic/CounselOptics/tests/unit/statute-of-limitations.test.ts`
- `/Users/technooptics/Advottic/CounselOptics/tests/unit/court-deadlines.test.ts`
- `/Users/technooptics/Advottic/CounselOptics/tests/unit/security-deposit-rules.test.ts`
- `/Users/technooptics/Advottic/CounselOptics/tests/e2e/public-pages.smoke.spec.ts`
- Edits: `/Users/technooptics/Advottic/CounselOptics/package.json` (scripts + devDeps) and a no-op refactor of `/Users/technooptics/Advottic/CounselOptics/app/tools/court-deadline-calculator/CourtDeadlineCalculator.tsx` to import from the new module.

Key bindings verified against the real source: `suggestSOL(accrualDateISO, state, claimType)` and the `ClaimType` union (snake_case: `breach_of_written_contract`, `medical_malpractice`, etc.) live in `lib/deadlines-data.ts`; `getState`/`getClaimType`/`formatYears`/`STATES_SOL`/`CLAIM_TYPES` (with hyphenated `ClaimTypeId`) live in `lib/statute-of-limitations.ts`; `getDepositRule`/`DEPOSIT_RULES`/`DepositRule` live in `lib/security-deposit-rules.ts`. The court-deadline math had no exported function, so the spec targets the extracted `lib/court-deadlines.ts`.