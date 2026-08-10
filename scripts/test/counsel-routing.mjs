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
 * The SHIPPED helpers are what run here. The function bodies used to be
 * MIRRORED into this file and the mirror is what every assertion below
 * exercised, backstopped by six substring checks on the source. Those checked
 * that six lines were still present, not that they were the whole function:
 * adding `if (href.startsWith('/counsel/settings')) return href;` at the top
 * of tenantHref reinstated the exact CR-5 dead-click this file is named for,
 * with all six needles still present and the script exiting 0.
 *
 * Node cannot import a .ts module directly, so it is compiled with the repo's
 * own typescript, the way scripts/test/scroll-lock-wheel.mjs already loads the
 * shipped lib/scroll-lock.ts. No runner is added and nothing is mirrored.
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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------
// The shipped lib/counsel-routing.ts, compiled. See the doc block above.
// ---------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, '..', '..', 'lib', 'counsel-routing.ts');
const source = readFileSync(sourcePath, 'utf8');

const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const shipped = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('exports', 'module', compiled)(shipped.exports, shipped);
const { tenantHref, isCounselItemActive } = shipped.exports;
for (const [name, fn] of [
  ['tenantHref', tenantHref],
  ['isCounselItemActive', isCounselItemActive],
]) {
  if (typeof fn !== 'function') {
    console.error(`FAIL: lib/counsel-routing.ts no longer exports ${name}.`);
    process.exit(1);
  }
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
// Account-menu containment.
//
// The counsel header menu used to link straight at the consumer
// /profile and /feedback. Those routes render under the ROOT layout,
// which paints the consumer sidebar, header and marketing footer, so
// clicking "Profile & settings" inside the firm workspace dropped an
// attorney into what reads as a different product. The fix was to give
// counsel its own account routes and repoint the menu at them.
//
// Nothing else in the repo holds that shape, and it is a one-character
// edit to undo, so it is asserted here. /admin is the deliberate
// exception: Advottic HQ is a separate application for platform staff
// and the menu item says so in its own subtitle.
// ---------------------------------------------------------------------
console.log('\n[account-menu] counsel account links stay under /counsel:');

const menuPath = join(here, '..', '..', 'components', 'counsel', 'CounselProfileMenuClient.tsx');
let menu = '';
try {
  menu = readFileSync(menuPath, 'utf8');
} catch (err) {
  console.error('  FAIL: cannot read', menuPath, err.message);
  failures++;
}

// Every href literal in the menu, minus the deliberate HQ hand-off.
const menuHrefs = [...menu.matchAll(/href="(\/[^"]*)"/g)]
  .map((m) => m[1])
  .filter((h) => h !== '/admin');
const escapees = menuHrefs.filter((h) => h !== '/counsel' && !h.startsWith('/counsel/'));
if (escapees.length === 0) {
  passes++;
} else {
  failures++;
  console.error('  FAIL: menu links leave the counsel shell into consumer chrome');
  console.error(`    offending href(s): ${escapees.join(', ')}`);
}

// The two destinations the menu is required to offer.
for (const needed of ['/counsel/profile', '/counsel/feedback']) {
  if (menuHrefs.includes(needed)) {
    passes++;
  } else {
    failures++;
    console.error(`  FAIL: account menu no longer links to ${needed}`);
  }
}

// Those destinations must actually exist, or the menu is a dead click.
const accountRoutes = [
  ['app/counsel/profile/page.tsx', 'counsel account page'],
  ['app/counsel/profile/api-tokens/page.tsx', 'counsel API tokens page'],
  ['app/counsel/feedback/page.tsx', 'counsel feedback page'],
];
for (const [rel, label] of accountRoutes) {
  try {
    readFileSync(join(here, '..', '..', rel), 'utf8');
    passes++;
  } catch {
    failures++;
    console.error(`  FAIL: ${label} is missing (${rel})`);
  }
}

// ---------------------------------------------------------------------
// Wiring the menu fix cannot reach.
//
// Repointing the menu only helps somebody who opens the menu. A bookmark
// at /profile, and the "no verified factor" way out of /verify-mfa, both
// still land a firm user in the consumer shell. The policy for that lives
// in lib/counsel-account-routes.ts and is exercised as a pure function in
// tests/counsel-account-routes.test.ts - but a policy nobody calls is a
// guard that passes while the bug is live, so the CALL SITES are asserted
// here, in the source, where a unit test cannot see them.
//
// The same applies to the two-factor control on the guest account page and
// to the link back to the consumer profile: the redirect above makes that
// link the only route to Safe Witness, theme, language and paired devices
// for anyone in a firm, so losing it strands them.
// ---------------------------------------------------------------------
console.log('\n[account-wiring] the fix is actually called:');

function assertContains(rel, needles, label) {
  let src = '';
  try {
    src = readFileSync(join(here, '..', '..', rel), 'utf8');
  } catch (err) {
    failures++;
    console.error(`  FAIL: cannot read ${rel} (${label}): ${err.message}`);
    return;
  }
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length === 0) {
    passes++;
  } else {
    failures++;
    console.error(`  FAIL: ${label} (${rel})`);
    console.error(`    missing: ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
  }
}

// Every consumer account route that has a counsel twin must consult the
// policy. Dropping the call restores the original bug silently: the page
// still renders, and the only symptom is the wrong shell.
assertContains(
  'app/profile/page.tsx',
  ['counselAccountRedirect', "counselAccountRedirect(\n    '/profile',"],
  'consumer profile routes a firm member to the counsel account page',
);
assertContains(
  'app/profile/api-tokens/page.tsx',
  ['counselAccountRedirect', "'/profile/api-tokens',"],
  'consumer API tokens routes a firm member into counsel',
);
assertContains(
  'app/feedback/page.tsx',
  ['counselAccountRedirect', "counselAccountRedirect(\n    '/feedback',"],
  'consumer feedback routes a firm member into counsel',
);

// The way back out. Without it, the redirect above makes the consumer-only
// sections unreachable for every firm member.
assertContains(
  'app/counsel/profile/account-panel.tsx',
  ['PERSONAL_PROFILE_HREF', 'href={PERSONAL_PROFILE_HREF}'],
  'counsel account page still links back to the personal profile',
);

// The MFA page's fallback link must not be hard-coded at the consumer route.
{
  const rel = 'app/verify-mfa/verify-mfa-form.tsx';
  let src = '';
  try {
    src = readFileSync(join(here, '..', '..', rel), 'utf8');
  } catch (err) {
    failures++;
    console.error(`  FAIL: cannot read ${rel}: ${err.message}`);
  }
  if (src && src.includes('href="/profile"')) {
    failures++;
    console.error(
      `  FAIL: ${rel} hard-codes href="/profile"; a firm user lands in the consumer shell`,
    );
  } else if (src.includes('accountHref')) {
    passes++;
  } else {
    failures++;
    console.error(`  FAIL: ${rel} no longer takes a resolved accountHref`);
  }
}

// A co-counsel guest is an outside attorney on a live matter, so the second
// factor has to be reachable from inside their own shell. It lives on the
// guest profile page rather than behind a widened path allowlist; see the
// doc block on that page and tests/counsel-guest-revocation.test.ts.
assertContains(
  'app/counsel/guest/profile/page.tsx',
  ['MfaSettings', '<MfaSettings />'],
  'a co-counsel guest can enrol two-factor from their own account page',
);

// Revalidation. Each of these actions writes something a counsel account
// surface renders; without the counsel path the page shows the old value
// after a successful action.
console.log('\n[account-wiring] counsel pages are revalidated after a write:');
assertContains(
  'lib/actions.ts',
  ["revalidatePath('/counsel/profile')", "revalidatePath('/counsel/feedback')"],
  'profile save and feedback submit revalidate their counsel pages',
);
assertContains(
  'lib/phone-verify-actions.ts',
  ["revalidatePath('/counsel/profile')"],
  'phone verification revalidates the counsel account page',
);
{
  const rel = 'app/profile/api-tokens/actions.ts';
  let src = '';
  try {
    src = readFileSync(join(here, '..', '..', rel), 'utf8');
  } catch (err) {
    failures++;
    console.error(`  FAIL: cannot read ${rel}: ${err.message}`);
  }
  // Both minting actions, not just the first one found.
  const hits = src.split("revalidatePath('/counsel/profile/api-tokens')").length - 1;
  if (hits >= 2) {
    passes++;
  } else {
    failures++;
    console.error(
      `  FAIL: ${rel} revalidates the counsel tokens page ${hits} time(s); both createTokenAction and createFirmTokenAction must`,
    );
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
