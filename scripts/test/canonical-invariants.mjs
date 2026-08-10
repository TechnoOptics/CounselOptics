#!/usr/bin/env node
/**
 * Regression guard for TECH-016: "the root layout canonical silently
 * deindexes any page that forgets to override it".
 *
 * app/layout.tsx set `alternates: { canonical: '/' }`. Next.js merges
 * metadata down the route tree, so every page that did not set its own
 * canonical inherited that one and told Google it was a duplicate of
 * the home page. Nothing fails, nothing logs, the page just stops being
 * indexed. Deleting the default fixes today's pages; only a guard stops
 * the next author from reintroducing it or shipping a page without one.
 *
 * Two invariants:
 *
 *   1. No layout under app/ sets a `canonical` in its metadata. A
 *      canonical is per-page by definition, so a layout-level one is
 *      always a default that some page will inherit wrongly.
 *
 *   2. Every publicly crawlable page declares either its own
 *      `alternates.canonical` or `robots: { index: false }`. Those are
 *      the only two honest answers. Silence is what this guard exists
 *      to catch.
 *
 * "Publicly crawlable" is derived from the DISALLOW list in
 * app/robots.ts rather than from a list kept here, so a route that
 * becomes public by leaving the disallow list is picked up
 * automatically and cannot be quietly exempted by editing this file.
 *
 * Source is comment-stripped before every check, via the same shared
 * stripper the other guards use. A file that only MENTIONS "canonical"
 * in a comment must not satisfy this.
 *
 *   node scripts/test/canonical-invariants.mjs
 *
 * Exit 0 = green. Non-zero = a page is silent about whether it wants to
 * be indexed; the failing page is printed with its route.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { stripComments } from './strip-comments.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appDir = join(root, 'app');

const failures = [];
function fail(msg) {
  failures.push(msg);
  console.log(`  FAIL ${msg}`);
}

// ---------------------------------------------------------------------
// The auth-gated prefixes, read from the one place that already lists
// them. Extracting rather than duplicating means the two files cannot
// disagree about which routes are public.
// ---------------------------------------------------------------------
const robotsSource = stripComments(
  readFileSync(join(appDir, 'robots.ts'), 'utf8'),
);
const disallowBlock = robotsSource.match(
  /const DISALLOW[^=]*=\s*\[([\s\S]*?)\n\];/,
);
if (!disallowBlock) {
  console.error(
    'canonical-invariants: could not find the DISALLOW array in ' +
      'app/robots.ts. Without it every route would look public and this ' +
      'guard would report nonsense. Fix the extraction, do not delete ' +
      'the check.',
  );
  process.exit(1);
}
const DISALLOW = [...disallowBlock[1].matchAll(/'([^']+)'/g)]
  .map((m) => m[1])
  .filter((p) => p !== '/_next/' && p !== '/static/');
if (DISALLOW.length < 20) {
  console.error(
    `canonical-invariants: extracted only ${DISALLOW.length} disallow ` +
      'prefixes from app/robots.ts, which is too few to be the real list. ' +
      'Refusing to run against a broken extraction.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------
// Walk app/ for page.tsx and layout.tsx.
// ---------------------------------------------------------------------
/** @type {string[]} */
const pages = [];
/** @type {string[]} */
const layouts = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      walk(full);
    } else if (name === 'page.tsx') {
      pages.push(full);
    } else if (name === 'layout.tsx') {
      layouts.push(full);
    }
  }
})(appDir);

/** app/foo/(group)/bar/page.tsx -> /foo/bar */
function routeOf(file) {
  const rel = relative(appDir, file).split(sep).slice(0, -1);
  const segments = rel.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

const isBlocked = (route) =>
  DISALLOW.some(
    (d) => route === d || route.startsWith(d.endsWith('/') ? d : `${d}/`),
  );

// ---------------------------------------------------------------------
// Invariant 1: no layout sets a canonical.
// ---------------------------------------------------------------------
console.log('\ncanonical invariants');
let layoutsChecked = 0;
for (const file of layouts) {
  const src = stripComments(readFileSync(file, 'utf8'));
  layoutsChecked += 1;
  if (/\bcanonical\b/.test(src)) {
    fail(
      `${relative(root, file)} sets a canonical in a LAYOUT. Every page ` +
        'below it inherits that URL and self-deindexes. Set the canonical ' +
        'on each page instead.',
    );
  }
}
console.log(`  ok ${layoutsChecked} layout(s) carry no inherited canonical`);

// ---------------------------------------------------------------------
// Invariant 2: every public page answers the question.
// ---------------------------------------------------------------------
let publicPages = 0;
let canonicalCount = 0;
let noindexCount = 0;
for (const file of pages) {
  const route = routeOf(file);
  if (isBlocked(route)) continue;
  publicPages += 1;
  const src = stripComments(readFileSync(file, 'utf8'));
  const hasCanonical = /\bcanonical\s*:/.test(src);
  const hasNoindex = /index\s*:\s*false|['"]noindex/.test(src);
  if (hasCanonical) canonicalCount += 1;
  else if (hasNoindex) noindexCount += 1;
  else {
    fail(
      `${relative(root, file)} (${route}) declares neither ` +
        '`alternates: { canonical: ... }` nor `robots: { index: false }`. ' +
        'A public page must say which it is.',
    );
  }
}

// A route-derivation bug that classified everything as blocked would
// leave nothing to check and exit green. Refuse that outcome.
if (publicPages < 40) {
  console.error(
    `canonical-invariants: only ${publicPages} public page(s) found, which ` +
      'means the route derivation is broken. Refusing to pass vacuously.',
  );
  process.exit(1);
}
console.log(
  `  ok ${publicPages} public page(s): ${canonicalCount} canonical, ` +
    `${noindexCount} noindex`,
);

if (failures.length > 0) {
  console.error(
    `\ncanonical-invariants FAILED (${failures.length}):\n` +
      failures.map((f) => `  - ${f}`).join('\n') +
      '\n',
  );
  process.exit(1);
}
console.log('\ncanonical-invariants passed.\n');
