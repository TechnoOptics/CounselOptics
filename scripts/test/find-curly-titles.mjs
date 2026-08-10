#!/usr/bin/env node
/**
 * Curly punctuation inside a `title:` metadata field.
 *
 * A page title travels into places that are not a browser: the Open Graph
 * card, a shared link preview, an email subject. Curly quotes and dashes
 * survive that trip inconsistently, so titles are written with straight
 * punctuation.
 *
 * TWO REASONS THIS FILE CHANGED. It shelled out to `powershell -c
 * Get-ChildItem`, so on macOS and on the ubuntu runner it threw before it
 * reached a single file. And even where powershell exists it only PRINTED a
 * count and exited 0, so a hit could never fail anything. A script under
 * scripts/test that cannot run and cannot fail is not a guard, it is a
 * decoration that reads like one.
 *
 * The walk is now plain fs, and a hit is a non-zero exit.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const files = walk(join(root, 'app'));
if (files.length < 100) {
  console.error(
    `FAILED: the walk found ${files.length} .tsx files under app/, which cannot be right; this guard would pass without looking at anything.`,
  );
  process.exit(1);
}

const CURLY_TITLE = /title:\s*['"][^'"\n]*[‘’“”][^'"\n]*['"]/;
const hits = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (CURLY_TITLE.test(line)) {
      hits.push(`${relative(root, file)}:${i + 1} ${line.trim()}`);
    }
  });
}

for (const hit of hits) console.error('  ' + hit);
console.log(
  `\n[curly-titles] ${files.length} file(s) read, ${hits.length} title field(s) with curly punctuation.`,
);
process.exit(hits.length === 0 ? 0 : 1);
