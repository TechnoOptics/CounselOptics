#!/usr/bin/env node
/**
 * A `<br>` inside an `<h1>` with no space around the break.
 *
 * The heading then reads as one run-together word wherever the break is
 * ignored, which includes a screen reader and any surface that flattens the
 * markup. The fix is a space on one side of the break.
 *
 * TWO REASONS THIS FILE CHANGED. It shelled out to `powershell -c
 * Get-ChildItem`, so on macOS and on the ubuntu runner it threw before it
 * reached a single file. And even where powershell exists it only PRINTED the
 * hits and exited 0, so a hit could never fail anything. A script under
 * scripts/test that cannot run and cannot fail is not a guard.
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

const hits = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!/<h1\b/i.test(src)) continue;
  for (const m of src.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) {
    const body = m[1];
    if (!/<br\s*\/?>/i.test(body)) continue;
    const tight =
      /[A-Za-z]\s*<br\s*\/?>\s*<[^>]+>\s*[A-Za-z]/i.test(body) ||
      /[A-Za-z]\s*<br\s*\/?>\s*[A-Za-z]/i.test(body);
    if (tight) {
      hits.push(`${relative(root, file)}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
}

for (const hit of hits) console.error('  ' + hit);
console.log(
  `\n[tight-br] ${files.length} file(s) read, ${hits.length} H1 tight-<br> instance(s).`,
);
process.exit(hits.length === 0 ? 0 : 1);
