#!/usr/bin/env node
/**
 * Regression guard for the signature-anchor / OCR-fallback feature.
 *
 * Verifies, against a real PDF generated in-memory with pdf-lib:
 *   1. A document with NO signature anchors gets a fallback box
 *      appended at the bottom of its last page (the V5 user ask).
 *   2. Each signer ends up with a distinct, valid (page,x,y) tuple.
 *   3. Caller-supplied positions are honored verbatim.
 *   4. The output PDF is parseable by pdf-lib (no malformed output).
 *
 * Run via:
 *   node scripts/test/signature-anchors.mjs
 *
 * Exit 0 = green, non-zero = failure (with details).
 *
 * The function under test lives in lib/signature-anchors.ts. Because
 * we can't directly import a .ts module from plain Node, we shell
 * out to `npx tsx` if available, else skip with a yellow warning so
 * CI can still proceed. The drift-guard portion of
 * scripts/test/counsel-routing.mjs covers the pure-string contract
 * for the lower-level helpers; this script covers the integration
 * with pdf-lib.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'signature-anchors-runner.ts');

// On win32 we use `shell: true` so PATH-based lookup of `npx`
// works, but that means the runner path needs to be quoted to
// survive the shell's word-splitting (the repo path contains
// spaces, e.g. "Techno Optics LLc"). On POSIX we run without a
// shell so the OS handles quoting automatically.
const isWin = process.platform === 'win32';
const runnerArg = isWin ? `"${runner}"` : runner;
const result = spawnSync('npx', ['--yes', 'tsx', runnerArg], {
  stdio: 'inherit',
  shell: isWin,
});

if (result.status === 0) {
  process.exit(0);
}
if (result.status === null && result.error) {
  console.warn(
    '\n[signature-anchors] SKIPPED: could not invoke `npx tsx`.',
    '\nInstall tsx (`npm i -D tsx`) to run this regression guard.',
    `\nUnderlying error: ${result.error.message}`,
  );
  // Soft-skip so CI doesn't fail solely on tsx absence. The TS
  // compiler still type-checks lib/signature-anchors.ts.
  process.exit(0);
}
process.exit(result.status ?? 1);
