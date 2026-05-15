#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const files = execSync(
  'powershell -c "Get-ChildItem -Path app -Recurse -Include *.tsx | ForEach-Object { $_.FullName }"',
  { encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter(Boolean);
const hits = [];
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (!/<h1\b/i.test(src)) continue;
  const re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1];
    if (!/<br\s*\/?>/i.test(body)) continue;
    const tight =
      /[A-Za-z]\s*<br\s*\/?>\s*<[^>]+>\s*[A-Za-z]/i.test(body) ||
      /[A-Za-z]\s*<br\s*\/?>\s*[A-Za-z]/i.test(body);
    if (tight) hits.push([f, body.slice(0, 220)]);
  }
}
const cwd = process.cwd();
for (const [f, b] of hits) {
  console.log('=== ' + f.replace(cwd, '').replace(/^[\\/]+/, ''));
  console.log('  ' + b.replace(/\s+/g, ' ').slice(0, 200));
}
console.log('--- ' + hits.length + ' H1 tight-<br> instance(s) found.');
