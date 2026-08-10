#!/usr/bin/env node
/**
 * Regression guard for TECH-001: "robots.txt per-agent groups revoke
 * the disallow list".
 *
 * RFC 9309 section 2.2.1: a crawler obeys only the group whose
 * user-agent matches its product token, and falls back to the "*"
 * group solely when NO named group matches. Named groups replace the
 * wildcard group, they do not inherit from it.
 *
 * app/robots.ts shipped a wildcard group carrying every Disallow, then
 * 25 named groups each carrying only "Allow: /". Under the rule above
 * that handed Googlebot, GPTBot, ClaudeBot and 22 others the entire
 * application. It survived because the source comment asserted the
 * opposite semantics, so nobody re-derived them.
 *
 * This guard runs the SHIPPED app/robots.ts. It is not a mirror and it
 * is not a text search: a comment describing the rule cannot satisfy
 * it, and neither can a disallow list that is merely present in the
 * file but absent from a group. app/robots.ts imports next/headers, so
 * the compiled module is given a stub `require` that returns a fixed
 * host, which is also how the apex and non-apex branches are both
 * exercised.
 *
 *   node scripts/test/robots-invariants.mjs
 *
 * Exit 0 = green. Non-zero = a group's rules drifted; the failing
 * assertion prints the group and what it is missing.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ts = require('typescript');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok ${label}`);
  } else {
    failures.push(detail ? `${label}: ${detail}` : label);
    console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------
// Load the shipped app/robots.ts with a stubbed next/headers.
// ---------------------------------------------------------------------
const source = readFileSync(join(root, 'app', 'robots.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

/** @param {string} host */
function robotsFor(host) {
  const stubRequire = (id) => {
    if (id === 'next/headers') {
      return { headers: () => ({ get: (k) => (k === 'host' ? host : null) }) };
    }
    throw new Error(`robots-invariants: unexpected import "${id}"`);
  };
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', 'require', compiled)(
    module_.exports,
    module_,
    stubRequire,
  );
  const fn = module_.exports.default;
  if (typeof fn !== 'function') {
    throw new Error('robots-invariants: app/robots.ts has no default export');
  }
  return fn();
}

const apex = robotsFor('advottic.com');
const rules = Array.isArray(apex.rules) ? apex.rules : [apex.rules];

/** @param {unknown} v */
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

console.log('\nrobots.txt group invariants');

// ---------------------------------------------------------------------
// 1. The wildcard group still carries a real disallow list.
// ---------------------------------------------------------------------
const wildcard = rules.find((r) => r.userAgent === '*');
check('a wildcard group exists', Boolean(wildcard));
const expected = wildcard ? asArray(wildcard.disallow) : [];
check(
  'the wildcard group disallows the application',
  expected.length >= 20,
  `only ${expected.length} disallow entries`,
);
// If this list ever shrinks to nothing, every parity check below would
// pass vacuously. Pin the entries that define the policy.
for (const required of ['/api/', '/admin', '/cases', '/counsel', '/billing', '/auth']) {
  check(
    `wildcard disallows ${required}`,
    expected.includes(required),
    'missing from the wildcard group',
  );
}

// ---------------------------------------------------------------------
// 2. THE POINT OF THIS FILE. Every named group repeats it verbatim.
// ---------------------------------------------------------------------
const named = rules.filter((r) => r.userAgent !== '*');
check(
  'named groups are present to check',
  named.length > 0,
  'no named groups found, so the parity check below proves nothing',
);
const want = [...expected].sort().join('\n');
for (const rule of named) {
  const got = asArray(rule.disallow).sort().join('\n');
  const missing = expected.filter((d) => !asArray(rule.disallow).includes(d));
  check(
    `group "${rule.userAgent}" repeats the full disallow list`,
    got === want,
    missing.length
      ? `missing ${missing.join(', ')}`
      : 'disallow list differs from the wildcard group',
  );
}

// ---------------------------------------------------------------------
// 3. Both sitemaps are declared, and the non-apex hosts stay closed.
// ---------------------------------------------------------------------
const sitemaps = asArray(apex.sitemap);
check(
  'sitemap.xml is declared',
  sitemaps.some((s) => s.endsWith('/sitemap.xml')),
);
check(
  'sitemap-images.xml is declared',
  sitemaps.some((s) => s.endsWith('/sitemap-images.xml')),
);

for (const host of ['hq.advottic.com', 'enterprise.advottic.com', 'acme.advottic.com']) {
  const r = robotsFor(host);
  const groups = Array.isArray(r.rules) ? r.rules : [r.rules];
  check(
    `${host} is disallowed entirely`,
    groups.length === 1 &&
      groups[0].userAgent === '*' &&
      asArray(groups[0].disallow).includes('/') &&
      asArray(groups[0].allow).length === 0,
  );
  check(`${host} declares no sitemap`, asArray(r.sitemap).length === 0);
}

// ---------------------------------------------------------------------
if (failures.length > 0) {
  console.error(
    `\nrobots-invariants FAILED (${failures.length}):\n` +
      failures.map((f) => `  - ${f}`).join('\n') +
      '\n\nA named User-agent group REPLACES the wildcard group under RFC\n' +
      '9309. Any group that omits a Disallow grants that agent the path.\n',
  );
  process.exit(1);
}
console.log(
  `\nrobots-invariants passed (${named.length} named group(s) checked against ` +
    `${expected.length} disallow entries).\n`,
);
