#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const files = execSync(
  'powershell -c "Get-ChildItem -Path app -Recurse -Include *.tsx | ForEach-Object { $_.FullName }"',
  { encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter(Boolean);
const SUFFIX = 'Claude Agent';
let total = 0;
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // title: '...curly...' or "...curly..."
    if (/title:\s*['"][^'"\n]*[‘’“”][^'"\n]*['"]/.test(l)) {
      const parts = f.split(SUFFIX);
      const rel = parts[parts.length - 1].replace(/^[\\/]+/, '');
      console.log(rel + ':' + (i + 1) + ' ' + l.trim());
      total++;
    }
  }
}
console.log('--- ' + total + ' title field(s) with curly punctuation remain.');
