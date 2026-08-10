#!/usr/bin/env node
/**
 * Regression guard for the two highest-stakes consumer surfaces: the
 * crisis-resources panels and the Safe Witness copy. Same drift-guard
 * pattern as scripts/test/i18n-a11y-invariants.mjs - assert the source
 * still holds the invariants, so a future refactor cannot silently:
 *
 *   - restyle a crisis panel dark-only again, which renders 911, the
 *     National Domestic Violence Hotline, 988 and Crisis Text Line as
 *     near-white text on a near-white light-mode background
 *   - reintroduce `sms:<number>&body=...`, which iOS and Android both
 *     parse as a literal recipient, so the message never prefills
 *   - tell someone in danger that their recording was hashed into the
 *     alert, uploaded off-device, or delivered to their contacts. None
 *     of those happen on web: the SHA-256 is computed in finalize()
 *     after fireAlert() and is never transmitted, /api/safe/audio is
 *     never called from the browser, and /api/safe/alert returns
 *     contacts_alerted = the count of CONFIGURED contacts.
 *
 * Run via `npm run test:crisis-copy` or
 * `node scripts/test/crisis-copy-invariants.mjs`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const failures = [];
const checked = [];

function read(file) {
  return readFileSync(join(root, file), 'utf8');
}

/* ------------------------------------------------------------------ *
 * 1. Crisis panels must be legible in BOTH themes.
 * ------------------------------------------------------------------ */

// This is a pin-the-regression guard, not a general contrast checker:
// DARK_ONLY_CLASS is a denylist of the four near-white classes that
// actually caused the bug, so a refactor to some other light shade
// (text-rose-200, text-slate-100) would still slip through. It exists
// to stop THIS defect coming back.
const CRISIS_PANELS = [
  { file: 'app/guides/[slug]/page.tsx', label: 'English guide crisis panel' },
  { file: 'app/es/guias/[slug]/page.tsx', label: 'Spanish guide crisis panel' },
];

const DARK_ONLY_CLASS = /(?<!dark:)\b(?:bg-rose-500\/10|text-rose-300|text-rose-100\/90|text-cream-100)\b/;

for (const { file, label } of CRISIS_PANELS) {
  const src = read(file);
  const start = src.indexOf('g.crisis &&');
  // Bound the end explicitly: a bare indexOf('<header') returning -1
  // would slice to one char before EOF and scan the whole page.
  const end = src.indexOf('<header');
  const panel = start === -1 ? '' : src.slice(start, end === -1 ? src.length : end);
  checked.push(label);

  if (!panel.includes('g.crisis')) {
    failures.push(`${label}: could not locate the crisis panel in ${file}`);
    continue;
  }
  const stray = panel.match(DARK_ONLY_CLASS);
  if (stray) {
    failures.push(
      `${label} (${file}): "${stray[0]}" is a dark-only class with no light-mode ` +
        `counterpart. Pair it as "<light> dark:<dark>" so the hotline numbers stay ` +
        `readable in light mode.`,
    );
  }
  // Whole class tokens, not substrings. `bg-rose-50` is a PREFIX of
  // `bg-rose-500`, so `panel.includes('bg-rose-50')` was answered by the
  // dark-mode class `dark:bg-rose-500/10` alone: deleting the light-mode
  // surface left a dark-only crisis panel, which renders 911 as near-white
  // text on a near-white light background, and this check printed ok.
  const classes = new Set(
    [...panel.matchAll(/class(?:Name)?="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)),
  );
  for (const need of ['bg-rose-50', 'dark:bg-rose-500/10']) {
    if (!classes.has(need)) {
      failures.push(`${label} (${file}): panel surface is missing "${need}".`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 2. No malformed sms: links anywhere in the app.
 * ------------------------------------------------------------------ */

// `sms:741741&body=HOME` - the separator before the first parameter
// must be `?`, not `&`. `?&body=` is the form that prefills on both
// iOS and Android, and is what the rest of the codebase already uses
// (components/ShareAppButton.tsx, app/api/safe/alert/route.ts).
const MALFORMED_SMS = /sms:[^"'`\s?]*&body=/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

const sourceFiles = [...walk('app'), ...walk('components'), ...walk('lib')];
checked.push(`${sourceFiles.length} source files scanned for malformed sms: links`);

for (const file of sourceFiles) {
  const src = read(file);
  const hit = src.match(MALFORMED_SMS);
  if (hit) {
    const line = src.slice(0, src.indexOf(hit[0])).split('\n').length;
    failures.push(
      `${relative('.', file)}:${line}: "${hit[0]}" uses "&" before the first sms ` +
        `parameter. iOS and Android read the whole string as the recipient, so the ` +
        `message never prefills. Use "?&body=".`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * 3. Safe Witness must not claim outcomes that did not happen.
 * ------------------------------------------------------------------ */

const SAFE_WITNESS_FALSE_CLAIMS = [
  {
    text: 'emailed with your',
    why: 'the SHA-256 is computed in finalize(), after fireAlert(), and is never sent',
  },
  {
    text: 'exist off-device',
    why: '/api/safe/audio is never called from the browser; the recording stays local',
  },
  {
    text: 'Your contact was alerted with your location',
    why: 'rendered even when fireAlert() failed or was canceled',
  },
  {
    text: 'alert goes only to the contact you set',
    why:
      'the locally-stored contact is never a recipient; /api/safe/alert fans out to ' +
      'safe_witness_contacts and profiles.safe_contact_email',
  },
];

// Positive counterparts, anchored to the full load-bearing sentence so
// deleting it cannot be masked by the same short phrase appearing
// elsewhere in the file.
const SAFE_WITNESS_REQUIRED = [
  {
    text: 'We cannot confirm they have received it',
    why:
      '/api/safe/alert returns contacts_alerted = CONFIGURED contacts and never ' +
      'reports per-contact delivery, so the success copy must say delivery is unconfirmed',
  },
  {
    text: 'The recording stays on this device',
    why: 'the recording and its SHA-256 are never uploaded from the browser',
  },
];

// DistressOverlay fires the SAME /api/safe/alert endpoint, so it is
// bound by the same limits. It additionally never starts a ping loop
// (no /api/safe/ping call in the file), so it must not promise a LIVE
// location, and route.ts resolves userPin to null when the user has no
// safe_witness_pin, so it must not promise a PIN unconditionally.
const DISTRESS_FALSE_CLAIMS = [
  {
    text: 'have been notified',
    why: 'a success response proves the request went out, never that it arrived',
  },
  {
    text: 'see a verification PIN',
    why: 'route.ts resolves userPin to null when safe_witness_pin is unset',
  },
  {
    text: 'Your live location is on the alert page',
    why: 'the overlay takes one best-effort fix and never starts a ping loop',
  },
];

const DISTRESS_REQUIRED = [
  {
    text: 'We cannot confirm they have received it',
    why: 'the overlay shares /api/safe/alert and its delivery is equally unconfirmed',
  },
];

// Collapse whitespace and JSX comment markers so a claim split across
// wrapped source lines still matches.
const safeWitness = read('components/SafeWitness.tsx')
  .replace(/^\s*\*/gm, ' ')
  .replace(/\s+/g, ' ');
checked.push('components/SafeWitness.tsx describes only what actually happened');

for (const { text, why } of SAFE_WITNESS_FALSE_CLAIMS) {
  if (safeWitness.includes(text)) {
    failures.push(
      `components/SafeWitness.tsx: still claims "${text}" - untrue because ${why}.`,
    );
  }
}

for (const { text, why } of SAFE_WITNESS_REQUIRED) {
  if (!safeWitness.includes(text)) {
    failures.push(
      `components/SafeWitness.tsx: missing the phrase "${text}" - needed because ${why}.`,
    );
  }
}

const distress = read('components/DistressOverlay.tsx')
  .replace(/^\s*\*/gm, ' ')
  .replace(/\s+/g, ' ');
checked.push('components/DistressOverlay.tsx describes only what actually happened');

for (const { text, why } of DISTRESS_FALSE_CLAIMS) {
  if (distress.includes(text)) {
    failures.push(
      `components/DistressOverlay.tsx: still claims "${text}" - untrue because ${why}.`,
    );
  }
}

for (const { text, why } of DISTRESS_REQUIRED) {
  if (!distress.includes(text)) {
    failures.push(
      `components/DistressOverlay.tsx: missing the phrase "${text}" - needed because ${why}.`,
    );
  }
}

/* ------------------------------------------------------------------ */

if (failures.length) {
  console.error('crisis-copy-invariants FAILED\n');
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

for (const c of checked) console.log(`  ok ${c}`);
console.log(`\ncrisis-copy-invariants passed (${checked.length} checks).`);
