#!/usr/bin/env node
/**
 * Regression guard for audit CR-5 / CR-28 ("Firm settings dead-click").
 *
 * This script asserts that the URL helpers in lib/counsel-routing.ts
 * produce the right output for every documented case. It runs without
 * a test framework so the repo doesn't pick up a Jest/Vitest/Playwright
 * tax just to guard a 20-line function. Run it from CI (or locally)
 * via:
 *
 *   node scripts/test/counsel-routing.mjs
 *
 * Exit code 0 = all green. Non-zero = a case is broken; the failing
 * assertion is printed with the expected vs actual values.
 *
 * Why the function bodies are duplicated here instead of imported:
 *   Node cannot natively import `.ts`. Adding a TS-aware runner
 *   (tsx / ts-node) just to test a 20-line function is overkill.
 *   Instead we MIRROR the canonical logic from lib/counsel-routing.ts
 *   below. The type-check (`npx tsc --noEmit`) guards the source; this
 *   script guards the behavior contract. If you change one, change
 *   both. There's a sanity assertion at the end that fails loudly if
 *   the source string in lib/counsel-routing.ts has drifted.
 *
 * History:
 *   - V3 audit (CR-28): added prefetch={false} on sidebar links.
 *   - V4 audit (CR-5):  same finding came back. Fix held.
 *   - V5 audit (CR-5+CR-28): regressed. Root cause: the canonical
 *     href "/counsel/settings" triggers a 307 redirect on tenant
 *     subdomains, and the client router occasionally collapses the
 *     redirect to a no-op. Fix: emit the short path directly in
 *     tenant mode.
 *
 * Every assertion below maps to a real user click path. DO NOT delete
 * the cases: they are the regression contract.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------
// Local copy of lib/counsel-routing.ts. See the doc block above.
// ---------------------------------------------------------------------
function tenantHref(href, tenantMode) {
  if (!tenantMode) return href;
  if (href === '/counsel' || href === '/counsel/') return '/';
  if (href.startsWith('/counsel/')) return href.slice('/counsel'.length);
  return href;
}

function isCounselItemActive(itemHref, pathname) {
  if (itemHref === '/counsel') {
    return pathname === '/counsel' || pathname === '/counsel/';
  }
  return pathname === itemHref || pathname.startsWith(itemHref + '/');
}

let failures = 0;
let passes = 0;
function expect(actual, expected, message) {
  if (actual === expected) {
    passes++;
    return;
  }
  failures++;
  console.error(`  FAIL: ${message}`);
  console.error(`    expected: ${JSON.stringify(expected)}`);
  console.error(`    actual:   ${JSON.stringify(actual)}`);
}

console.log('\n[CR-5+CR-28] tenantHref:');

// Apex mode: hrefs pass through unchanged.
expect(tenantHref('/counsel', false), '/counsel', 'apex /counsel');
expect(tenantHref('/counsel/settings', false), '/counsel/settings', 'apex /counsel/settings');
expect(tenantHref('/counsel/cases', false), '/counsel/cases', 'apex /counsel/cases');
expect(tenantHref('/counsel/cases/abc-123', false), '/counsel/cases/abc-123', 'apex /counsel/cases/:id');

// Tenant mode: prefix stripped.
expect(tenantHref('/counsel', true), '/', 'tenant /counsel -> /');
expect(tenantHref('/counsel/', true), '/', 'tenant /counsel/ -> /');
expect(tenantHref('/counsel/settings', true), '/settings', 'tenant /counsel/settings -> /settings');
expect(tenantHref('/counsel/cases', true), '/cases', 'tenant /counsel/cases -> /cases');
expect(tenantHref('/counsel/cases/abc-123', true), '/cases/abc-123', 'tenant nested');

// Defensive passthrough: non-counsel hrefs unchanged in either mode.
expect(tenantHref('/', true), '/', 'tenant root passthrough');
expect(tenantHref('/about', true), '/about', 'tenant non-counsel passthrough');
expect(tenantHref('/about', false), '/about', 'apex non-counsel passthrough');

console.log('\n[CR-14] isCounselItemActive:');

// Dashboard highlights only on /counsel.
expect(isCounselItemActive('/counsel', '/counsel'), true, 'dashboard active on /counsel');
expect(isCounselItemActive('/counsel', '/counsel/'), true, 'dashboard active on /counsel/');
expect(isCounselItemActive('/counsel', '/counsel/cases'), false, 'dashboard NOT active on /counsel/cases');
expect(isCounselItemActive('/counsel', '/counsel/settings'), false, 'dashboard NOT active on /counsel/settings');

// Other items: active on exact match or descendant.
expect(isCounselItemActive('/counsel/settings', '/counsel/settings'), true, 'settings active on exact');
expect(isCounselItemActive('/counsel/settings', '/counsel/settings/webhooks'), true, 'settings active on descendant');
expect(isCounselItemActive('/counsel/cases', '/counsel/cases/abc-123'), true, 'cases active on case detail');
expect(isCounselItemActive('/counsel/cases', '/counsel'), false, 'cases NOT active on dashboard');
expect(isCounselItemActive('/counsel/cases', '/counsel/cases-archive'), false, 'no prefix-collision: /cases vs /cases-archive');

// ---------------------------------------------------------------------
// Drift guard: make sure the TS source still contains the same logic
// strings we mirror above. Fails loudly when a future edit changes one
// half without the other.
// ---------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, '..', '..', 'lib', 'counsel-routing.ts');
let source = '';
try {
  source = readFileSync(sourcePath, 'utf8');
} catch (err) {
  console.error('  FAIL: cannot read', sourcePath, err.message);
  failures++;
}

const driftChecks = [
  [`if (!tenantMode) return href;`, 'tenantHref: apex passthrough'],
  [`if (href === '/counsel' || href === '/counsel/') return '/';`, 'tenantHref: dashboard collapse'],
  [`if (href.startsWith('/counsel/'))`, 'tenantHref: prefix strip guard'],
  [`return href.slice('/counsel'.length);`, 'tenantHref: prefix strip'],
  [`if (itemHref === '/counsel')`, 'isActive: dashboard branch'],
  [`pathname === itemHref || pathname.startsWith(itemHref + '/')`, 'isActive: prefix or exact'],
];
console.log('\n[drift-guard] lib/counsel-routing.ts:');
for (const [needle, label] of driftChecks) {
  if (source.includes(needle)) {
    passes++;
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
    console.error(`    missing string: ${JSON.stringify(needle)}`);
  }
}

console.log('');
if (failures === 0) {
  console.log(`OK: ${passes} assertions passed.`);
  process.exit(0);
} else {
  console.error(`FAILED: ${failures} failure(s), ${passes} pass(es).`);
  process.exit(1);
}
