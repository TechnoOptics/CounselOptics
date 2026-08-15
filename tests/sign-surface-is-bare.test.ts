import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A document somebody was sent to sign carries no marketing chrome.
 *
 * /sign is not in APP_ROUTE_PREFIXES, so the root layout treated it as a
 * MARKETING page. Fetched from PRODUCTION on 2026-08-15, an outside
 * counterparty opening a signing link was served a sticky header with "Sign
 * in" and "Pricing", a footer, and a nav offering Features, Cases, New case,
 * Find counsel, Public defender, Review my document, Pricing, Glossary,
 * Guides and Free templates.
 *
 * On a phone that header overlaps the signing card, which is what was
 * reported. The layout is the smaller half: somebody binding themselves to an
 * NDA is being shown "New case" and invited into the funnel, on a surface that
 * belongs to the FIRM that sent it.
 *
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST, stated because the
 * distinction cost a wrong reading. The gate reads `x-pathname`, which the
 * middleware sets. Under `next dev` that header is absent, pathname is '', and
 * EVERY route gate fails open - so a dev build shows the chrome on /safe too,
 * where the same mechanism demonstrably works in production:
 *
 *     production  /                   header: yes
 *     production  /safe               header: NO    <- isOverlayRoute works
 *     production  /sign/<token>       header: yes   <- the defect
 *
 * A dev render therefore cannot answer this question, and asserting against
 * one would have been a green test proving nothing. What this holds instead is
 * that /sign is wired into the same gate that is proven to work for /safe.
 */

const LAYOUT = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

describe('the signing surface is bare', () => {
  it('/sign is excluded from the site chrome', () => {
    expect(LAYOUT).toMatch(
      /const isBareDocumentRoute =\s*\n?\s*pathname === '\/sign' \|\| pathname\.startsWith\('\/sign\/'\)/,
    );
  });

  it('the exclusion actually reaches showSiteChrome', () => {
    // The failure this prevents is the one this repository keeps producing: a
    // flag that is computed and then never consulted.
    expect(LAYOUT).toMatch(
      /const showSiteChrome = !isShellMode && !isOverlayRoute && !isBareDocumentRoute;/,
    );
  });

  it('covers the phone handoff routes as well as the signer page', () => {
    // /sign/m/<handoff> and /sign/mark/<handoff>/pad are the phone surfaces.
    // A prefix match is what makes them bare too; an equality check alone
    // would leave the phone carrying the nav.
    expect(LAYOUT).toContain("pathname.startsWith('/sign/')");
  });

  it('leaves /safe on its own gate rather than merging the two', () => {
    // Different reasons with different lifetimes: /safe drops chrome because a
    // full-screen panel is painted over it. Collapsing them would lose that.
    expect(LAYOUT).toMatch(/const isOverlayRoute = pathname === '\/safe'/);
  });
});
