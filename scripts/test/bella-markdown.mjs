#!/usr/bin/env node
/**
 * Regression guard for audit P1-2 ("Bella shows literal asterisks /
 * dead [text](#) links"). Asserts the contract of
 * lib/bella-markdown.ts against the actual failing strings from the
 * V1 audit report.
 *
 * Same drift-guard pattern as scripts/test/counsel-routing.mjs: the
 * function body is mirrored here for Node-direct runs, and a final
 * grep against lib/bella-markdown.ts fails loudly if the source
 * loses any of the documented replace rules.
 *
 * Run via `npm run test:bella-markdown` or `node scripts/test/bella-markdown.mjs`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function stripBellaMarkdown(s) {
  return s
    .replace(/\[([^\]]+)\]\(\s*#\s*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_(?!\s)([^_\n]+?)(?<!\s)_(?!_)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/\*{1,2}$/g, '')
    .replace(/_{1,2}$/g, '');
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

// Drift guard: same pattern as scripts/test/counsel-routing.mjs.
console.log('\n[drift-guard] lib/bella-markdown.ts:');
const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, '..', '..', 'lib', 'bella-markdown.ts');
let source = '';
try {
  source = readFileSync(sourcePath, 'utf8');
} catch (err) {
  failures++;
  console.error('  FAIL: cannot read', sourcePath, err.message);
}
const driftChecks = [
  [String.raw`\[([^\]]+)\]\(\s*#\s*\)`, 'empty-anchor regex'],
  [String.raw`\*\*([^*]+)\*\*`, 'bold-strip regex'],
  [String.raw`\*{1,2}$`, 'tail ** strip'],
];
for (const [needle, label] of driftChecks) {
  if (source.includes(needle)) {
    passes++;
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
    console.error(`    missing pattern: ${JSON.stringify(needle)}`);
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
