#!/usr/bin/env node
/**
 * A published price must be derived, never retyped.
 *
 * The drift this catches was live: the home-page JSON-LD advertised
 * "Personal Pro $19" and "Personal Plus $29" while the shipped ladder was
 * Free / Starter $19 / Plus $29 / Pro $59 / Ultra $99. Two published tier
 * names did not exist, the two most expensive real tiers were missing
 * from the SERP, and the /pricing aggregate said 6 offers against 9 real
 * tiers. /llms-full.txt repeated the same invented tiers to every AI
 * assistant that quotes it.
 *
 * tests/published-pricing.test.ts checks that the DERIVED values match
 * lib/personal-tiers.ts and lib/firm-pricing.ts. It cannot see someone
 * bypassing the derivation and typing a number in again, which is exactly
 * how the drift started. This guard covers that: in a publishing surface,
 * a literal price or tier count is a failure even when it happens to be
 * correct today, because "correct today" is what the last one was.
 *
 * Comments and metadata copy are stripped before scanning: prose about
 * the bug is allowed to name the numbers, and a page <title> or OG
 * description is marketing copy reviewed by hand, not a price list.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Surfaces that publish prices to the outside world. */
const WATCHED = [
  'components/seo/JsonLd.tsx',
  'app/llms.txt/route.ts',
  'app/llms-full.txt/route.ts',
];

/** The module every one of them must read its numbers from. */
const SOURCE = '@/lib/published-pricing';

/**
 * Strip block comments, line comments, and import lines. Without this the
 * guard trips on its own explanation of the bug.
 */
function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
}

const failures = [];
let scanned = 0;

for (const rel of WATCHED) {
  const full = join(root, rel);
  if (!existsSync(full)) {
    failures.push(
      `${rel}: watched file is missing. Either it moved (update WATCHED) or this guard has been scanning nothing.`,
    );
    continue;
  }
  const raw = readFileSync(full, 'utf8');
  if (raw.length < 500) {
    failures.push(
      `${rel}: only ${raw.length} bytes, which cannot be right; this guard would pass without looking at anything.`,
    );
    continue;
  }
  scanned += 1;
  const body = strip(raw);

  if (!raw.includes(SOURCE)) {
    failures.push(
      `${rel}: publishes prices but does not import from ${SOURCE}. Derive the numbers; do not retype them.`,
    );
  }

  body.split('\n').forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    const text = line.trim();

    // A dollar amount written out, e.g. "$19" or "$1,800".
    if (/\$\d/.test(line)) {
      failures.push(`${at} literal price: ${text}`);
    }
    // A JSON-LD price field with a hardcoded value.
    if (/\b(price|lowPrice|highPrice)\s*:\s*['"]?\d/.test(line)) {
      failures.push(`${at} hardcoded price field: ${text}`);
    }
    // A hardcoded tier count.
    if (/\bofferCount\s*:\s*\d/.test(line)) {
      failures.push(`${at} hardcoded offerCount: ${text}`);
    }
    // A tier count spelled as a word, which is how "six tiers" survived
    // being wrong by three.
    if (
      /\b(three|four|five|six|seven|eight|nine|ten)\s+(subscription\s+)?tiers\b/i.test(
        line,
      )
    ) {
      failures.push(`${at} tier count written as a word: ${text}`);
    }
  });
}

if (scanned !== WATCHED.length) {
  failures.push(
    `only ${scanned} of ${WATCHED.length} watched files were scanned.`,
  );
}

for (const failure of failures) console.error('  ' + failure);
console.log(
  `\n[published-pricing] ${scanned} publishing surface(s) scanned, ${failures.length} literal(s) found.`,
);
process.exit(failures.length === 0 ? 0 : 1);
