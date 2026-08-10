#!/usr/bin/env node
/**
 * Regression guard for audit P1-2 ("Bella shows literal asterisks /
 * dead [text](#) links"). Asserts the contract of
 * lib/bella-markdown.ts against the actual failing strings from the
 * V1 audit report.
 *
 * The SHIPPED function is what runs here. This used to mirror the body
 * into this file and exercise the copy, with three of the twelve replace
 * rules grepped out of the source as a drift guard. Deleting the inline-code
 * rule from lib/bella-markdown.ts, which puts literal backticks back in front
 * of a distressed reader, left every assertion below green: they were all
 * measuring the mirror. Node cannot import a .ts module directly, so it is
 * compiled with the repo's own typescript, the same way
 * scripts/test/scroll-lock-wheel.mjs loads the shipped lib/scroll-lock.ts.
 *
 * Run via `npm run test:bella-markdown` or `node scripts/test/bella-markdown.mjs`.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, '..', '..', 'lib', 'bella-markdown.ts');
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
const { stripBellaMarkdown } = shipped.exports;
if (typeof stripBellaMarkdown !== 'function') {
  console.error('FAIL: lib/bella-markdown.ts no longer exports stripBellaMarkdown.');
  process.exit(1);
}

let passes = 0;
let failures = 0;
function expect(actual, expected, msg) {
  if (actual === expected) {
    passes++;
    return;
  }
  failures++;
  console.error(`  FAIL: ${msg}`);
  console.error(`    expected: ${JSON.stringify(expected)}`);
  console.error(`    actual:   ${JSON.stringify(actual)}`);
}

console.log('\n[bella-markdown] V1 audit P1-2 evidence strings:');

// The actual rendering bug the audit caught.
expect(
  stripBellaMarkdown('Read the **late-fee** section carefully.'),
  'Read the late-fee section carefully.',
  '**bold** strip',
);
expect(
  stripBellaMarkdown('[sign in at /sign-in](#) to get started'),
  'sign in at /sign-in to get started',
  '[text](#) collapse',
);
expect(
  stripBellaMarkdown('You owe __$1,200__ by Friday.'),
  'You owe $1,200 by Friday.',
  '__underline__ strip',
);
expect(
  stripBellaMarkdown('Try `npm install` first.'),
  'Try npm install first.',
  '`inline code` strip',
);

console.log('\n[bella-markdown] bullet + heading lines collapse to prose:');
expect(
  stripBellaMarkdown('# Heading\n- item one\n- item two\n1. ordered'),
  'Heading\nitem one\nitem two\nordered',
  'leading markers all stripped',
);
expect(
  stripBellaMarkdown('> quoted block'),
  'quoted block',
  'leading > stripped',
);

console.log('\n[bella-markdown] does NOT eat content:');
expect(
  stripBellaMarkdown('Visit [our site](https://example.com) for more.'),
  'Visit [our site](https://example.com) for more.',
  'real links are preserved (only empty # anchor is collapsed)',
);
expect(
  stripBellaMarkdown('Just plain text with no chrome.'),
  'Just plain text with no chrome.',
  'plain prose passthrough',
);
// Bullet asterisks at line start, not inline emphasis. Stripped.
expect(
  stripBellaMarkdown('* item with a *trailing* word'),
  'item with a trailing word',
  'leading bullet + inline italic both handled',
);
// Italic across a single line.
expect(
  stripBellaMarkdown('A *very* fast response.'),
  'A very fast response.',
  'inline italic strip',
);

console.log('\n[bella-markdown] tail-stray emphasis closure:');
expect(
  stripBellaMarkdown('They never closed the emphasis**'),
  'They never closed the emphasis',
  'trailing ** stripped',
);
expect(
  stripBellaMarkdown('half italic_'),
  'half italic',
  'trailing _ stripped',
);

// Every replace rule in the shipped module is exercised above, not grepped.
// This is the one thing behaviour cannot show: that the module still ships
// twelve rules, so a rule added without a case here is noticed.
console.log('\n[coverage] lib/bella-markdown.ts:');
const ruleCount = (source.match(/\.replace\(/g) ?? []).length;
if (ruleCount === 12) {
  passes++;
} else {
  failures++;
  console.error(
    `  FAIL: lib/bella-markdown.ts now has ${ruleCount} replace rules, not 12.`,
  );
  console.error('    Add a case above for the new rule, then update this count.');
}

console.log('');
if (failures === 0) {
  console.log(`OK: ${passes} assertions passed.`);
  process.exit(0);
} else {
  console.error(`FAILED: ${failures} failure(s), ${passes} pass(es).`);
  process.exit(1);
}
