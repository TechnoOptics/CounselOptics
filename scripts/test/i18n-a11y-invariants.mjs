#!/usr/bin/env node
/**
 * Regression guard for the consumer i18n + accessibility invariants
 * (audit "now"-tier CI gate). Same drift-guard pattern as
 * scripts/test/bella-markdown.mjs: assert that source files still contain
 * the load-bearing wiring, so a future refactor can't silently:
 *   - un-wire the consumer runtime translation or the language switcher
 *   - drop data-no-translate off a streaming AI region (which would make
 *     the MutationObserver re-translate partial sentences every chunk) or
 *     off user-entered proper nouns (which MT would then mangle)
 *   - remove the aria-live / role="alert" a11y hooks added for screen
 *     readers on the flagship consumer surfaces
 *
 * Run via `npm run test:i18n-a11y` or `node scripts/test/i18n-a11y-invariants.mjs`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from './strip-comments.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Each check: the file must contain EVERY listed substring. */
const CHECKS = [
  {
    file: 'app/layout.tsx',
    label: 'consumer i18n is wired into the root layout',
    needs: [
      // The ELEMENT, not the name: unwrapping both <AutoTranslate> wrappers and
      // keeping the import turned consumer runtime translation off with this
      // check still green.
      '<AutoTranslate',
      'LanguageSwitcher',
      'getLocaleCookie',
      'consumerI18n', // the non-shell / non-/sign / non-/es gate
    ],
  },
  {
    file: 'components/Decoder.tsx',
    label: 'Decoder output is aria-live and excluded from auto-translate',
    needs: ['aria-live', 'data-no-translate'],
  },
  {
    file: 'components/Bella.tsx',
    label: 'Bella message scroller is excluded from auto-translate',
    needs: ['data-no-translate'],
  },
  {
    file: 'components/OpposingCounsel.tsx',
    label: 'Mock Trial transcript is a live region and not auto-translated',
    needs: ['role="log"', 'aria-live', 'data-no-translate', 'aria-label'],
  },
  {
    file: 'components/UserMenuClient.tsx',
    label: 'user identity (name/email/firm) is not machine-translated',
    needs: ['data-no-translate'],
  },
  {
    file: 'app/cases/page.tsx',
    label: 'case titles / subject names are not machine-translated',
    needs: ['data-no-translate'],
  },
  {
    file: 'app/community/[slug]/witness/letter/letter-form.tsx',
    label: 'public letter form announces validation errors to screen readers',
    needs: ['role="alert"'],
  },
  {
    file: 'app/community/[slug]/witness/evidence/evidence-form.tsx',
    label: 'public evidence form announces validation errors to screen readers',
    needs: ['role="alert"'],
  },
];

let failures = 0;
for (const check of CHECKS) {
  let src;
  try {
    src = readFileSync(join(root, check.file), 'utf8');
  } catch {
    console.error(`✗ ${check.file}: file not found (${check.label})`);
    failures += 1;
    continue;
  }
  const missing = check.needs.filter((n) => !stripComments(src).includes(n));
  if (missing.length > 0) {
    console.error(
      `✗ ${check.file}: ${check.label}\n    missing: ${missing.join(', ')}`,
    );
    failures += 1;
  } else {
    console.log(`✓ ${check.file}: ${check.label}`);
  }
}

if (failures > 0) {
  console.error(
    `\ni18n/a11y invariant guard FAILED: ${failures} check(s) regressed.`,
  );
  process.exit(1);
}
console.log('\nAll i18n/a11y invariants hold.');
