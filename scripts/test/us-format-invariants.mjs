#!/usr/bin/env node
/**
 * No new locale-less `toLocale*` call.
 *
 * WHAT IS WRONG WITH ONE. `date.toLocaleDateString()` and
 * `date.toLocaleDateString(undefined, {...})` both mean "use whatever locale
 * the host happens to have". During SSR that is the Node worker's locale; after
 * hydration it is the browser's. So one page can render the same date two ways
 * (React #425), and a reader whose browser is set to a non-US locale gets
 * day-first dates. `03/04/2026` is March 4th in the United States and April 3rd
 * almost everywhere else. On a filing deadline or a court exhibit that is a
 * correctness defect, not a preference.
 *
 * The fix is lib/format.ts, which pins en-US in one place. A call that passes
 * an explicit locale string is accepted too, because 63 call sites already did
 * that correctly before the module existed.
 *
 * HOW THIS AVOIDS THE WAYS THE OBVIOUS CHECK LIES.
 *
 *   - The file list is derived from `git ls-files`, not hardcoded and not from
 *     a hand-maintained array, so a new file is covered the day it lands.
 *   - Files are read with fs, not piped through grep. A literal NUL byte makes
 *     grep skip a whole file in silence; readFileSync does not care.
 *   - Calls are found by scanning the source as one string, not line by line,
 *     so a call whose arguments span several lines is still seen. The owner's
 *     line-based grep reported 136 hits; scanning this way found 191.
 *   - Occurrences inside comments and string literals are ignored, because a
 *     doc comment DESCRIBING this bug is not an instance of it. Three such
 *     comments exist, including the one in components/LocaleTime.tsx.
 *
 * KNOWN OFFENDERS. The paths in KNOWN below still contain locale-less calls
 * and were deliberately not converted: each is owned by other concurrent work.
 * They are real remaining defects, not exemptions on the merits. The guard
 * fails if one of them stops having any offender, so the list prunes itself
 * rather than going stale.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Still to convert. Owned by other branches in flight at the time this guard
 * landed; converting them here would have collided.
 */
const KNOWN = [
  'app/admin/consumer/page.tsx',
  'app/admin/counsel/page.tsx',
  'app/admin/crashes/page.tsx',
  'app/admin/health/page.tsx',
  'app/admin/page.tsx',
  'app/admin/security-center/page.tsx',
  'app/counsel/forms/approvals/[id]/page.tsx',
  'app/portal/forms/submissions/[id]/page.tsx',
  'app/sign/[token]/page.tsx',
  'lib/pdf.ts',
];

const METHODS = ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'];

/**
 * Mark every byte as code (0) or not-code (1): comments and string literals
 * are not code, but a template literal's `${...}` hole is.
 *
 * Two rules that matter in a .tsx file. A `'...'` literal cannot contain an
 * unescaped newline, so an apostrophe in JSX prose ("you're") ends at the line
 * break instead of swallowing the rest of the file. And `//` inside a URL
 * ("https://") is not a comment.
 */
function maskNonCode(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const tplBase = [];
  let braceDepth = 0;
  const inTplText = () =>
    tplBase.length > 0 && braceDepth === tplBase[tplBase.length - 1];

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (inTplText()) {
      if (c === '\\') { mask[i++] = 1; if (i < src.length) mask[i++] = 1; continue; }
      if (c === '`') { mask[i++] = 1; tplBase.pop(); continue; }
      if (c === '$' && d === '{') { mask[i++] = 1; mask[i++] = 1; braceDepth++; continue; }
      mask[i++] = 1;
      continue;
    }
    if (c === '/' && d === '/' && src[i - 1] !== ':') {
      while (i < src.length && src[i] !== '\n') mask[i++] = 1;
      continue;
    }
    if (c === '/' && d === '*') {
      mask[i++] = 1; mask[i++] = 1;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) mask[i++] = 1;
      if (i < src.length) { mask[i++] = 1; mask[i++] = 1; }
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { closed = true; break; }
        j++;
      }
      if (closed) { while (i <= j) mask[i++] = 1; continue; }
      i++; // an apostrophe in prose, not a literal
      continue;
    }
    if (c === '`') { mask[i++] = 1; tplBase.push(braceDepth); continue; }
    if (c === '{') braceDepth++;
    else if (c === '}') {
      braceDepth--;
      if (tplBase.length && braceDepth === tplBase[tplBase.length - 1]) mask[i] = 1;
    }
    i++;
  }
  return mask;
}

/** Every `.toLocale*(...)` call in real code, with its first argument. */
function findCalls(src) {
  const mask = maskNonCode(src);
  const out = [];
  for (const method of METHODS) {
    let idx = 0;
    for (;;) {
      idx = src.indexOf(method, idx);
      if (idx === -1) break;
      const after = src[idx + method.length] ?? '';
      if (mask[idx] === 1 || src[idx - 1] !== '.' || !/[\s(]/.test(after)) {
        idx += method.length;
        continue;
      }
      let p = idx + method.length;
      while (/\s/.test(src[p])) p++;
      if (src[p] !== '(') { idx += method.length; continue; }
      let depth = 0, quote = null, k = p;
      for (; k < src.length; k++) {
        const c = src[k];
        if (quote) {
          if (c === '\\') k++;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) break; }
      }
      const args = src.slice(p + 1, k).trim();
      const firstArg = args.split(/,(?![^{]*})/)[0]?.trim() ?? '';
      out.push({
        method,
        firstArg,
        line: src.slice(0, idx).split('\n').length,
      });
      idx = k;
    }
  }
  return out;
}

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));

// A derived list that came back short would let this guard pass without
// looking at anything.
if (files.length < 300) {
  console.error(
    `FAILED: git ls-files returned only ${files.length} source files, which cannot be right.`,
  );
  process.exit(1);
}

const offenders = new Map(); // path -> ["path:line .method(args)"]
let calls = 0;
let pinned = 0;

for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  if (!METHODS.some((m) => src.includes(m))) continue;
  for (const call of findCalls(src)) {
    calls++;
    if (/^['"]/.test(call.firstArg)) { pinned++; continue; }
    const list = offenders.get(rel) ?? [];
    list.push(
      `${rel}:${call.line} .${call.method}(${call.firstArg || ''}) has no locale`,
    );
    offenders.set(rel, list);
  }
}

// The scan has to be seeing the already-correct calls too, or its notion of a
// call is broken and its silence about the rest means nothing.
if (pinned < 40) {
  console.error(
    `FAILED: only ${pinned} call(s) with an explicit locale were found; the scanner is not matching calls.`,
  );
  process.exit(1);
}

const failures = [];
for (const [rel, list] of offenders) {
  if (!KNOWN.includes(rel)) failures.push(...list);
}
for (const rel of KNOWN) {
  if (!offenders.has(rel)) {
    failures.push(
      `${rel} is listed as a known offender but has none left; delete it from KNOWN in ${'scripts/test/us-format-invariants.mjs'}.`,
    );
  }
}

for (const f of failures) console.error('  ' + f);
console.log(
  `\n[us-format] ${files.length} file(s) read, ${calls} toLocale* call(s), ` +
    `${pinned} with an explicit locale, ` +
    `${[...offenders.values()].reduce((n, l) => n + l.length, 0)} without ` +
    `(all in the ${KNOWN.length} known-offender path(s)).`,
);
if (failures.length) {
  console.error(
    `\nFAILED: ${failures.length} problem(s). Route the call through lib/format.ts.`,
  );
  process.exit(1);
}
process.exit(0);
