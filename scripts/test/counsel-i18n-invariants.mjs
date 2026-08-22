#!/usr/bin/env node
/**
 * Regression guard for the COUNSEL (authenticated firm) i18n wiring.
 *
 * The consumer surface uses a DOM-walking AutoTranslate (guarded by
 * scripts/test/i18n-a11y-invariants.mjs). The counsel surface uses a
 * different mechanism: an explicit <T> / useT() dictionary under a
 * <LocaleProvider>. This guard protects that mechanism against silent
 * drift, in two parts:
 *
 *   1. PRESENCE - the load-bearing plumbing stays wired: the provider
 *      still wraps the counsel layout, the T component + useT hook +
 *      the <Tt> tooltip helper stay exported, and a sample of flagship
 *      surfaces still import the translator. If any of these vanish in
 *      a refactor, every <T> silently degrades to English with no
 *      runtime error - exactly the kind of quiet regression a guard
 *      should catch.
 *
 *   2. DYNAMIC-WRAP REVIEW GATE - every `<T>{expr}</T>` (a T whose only
 *      child is a braced expression, rather than a static literal) must
 *      wrap a STATIC value: a fixed UI label, a static-array map param,
 *      a constant-map lookup, or a ternary of string literals. Wrapping
 *      DB/user data (a case title, client name, amount, status) would
 *      ship that data to the machine-translation engine and mangle it.
 *      A grep can't tell `c.name` (a static palette name) from
 *      `c.title` (a case title), so instead of guessing we require every
 *      braced-<T> expression to be on an explicit allowlist. Static
 *      `<T>literal</T>` wraps have no braces and never trip this. A NEW
 *      braced wrap fails CI until a human confirms it is static and adds
 *      its normalized form to ALLOWED_DYNAMIC_WRAPS below - the review
 *      step is the point (SOC 2 CC8.1 change-management).
 *
 * Pure-Node, zero-dependency. Run via `npm run test:counsel-i18n` or
 * `node scripts/test/counsel-i18n-invariants.mjs`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { stripComments } from './strip-comments.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPORT = "from '@/components/i18n/LocaleProvider'";

/* ---- Part 1: presence invariants (each file must contain EVERY string) ---- */
const CHECKS = [
  {
    file: 'app/counsel/layout.tsx',
    label:
      'LocaleProvider wraps the counsel surface (else every <T> degrades to English)',
    // The ELEMENT, not the name. Replacing both <LocaleProvider> wrappers with
    // fragments and keeping the import left this check green while every <T>
    // in the counsel surface degraded to English, which is the whole thing it
    // exists to catch. The line-342 comment naming the provider would have
    // done the same on its own.
    needs: ['<LocaleProvider'],
  },
  {
    file: 'components/i18n/LocaleProvider.tsx',
    label: 'the T component, useT hook, and LocaleProvider stay exported',
    needs: [
      'export function LocaleProvider',
      'export function T',
      'export function useT',
    ],
  },
  {
    file: 'components/i18n/Tt.tsx',
    label: 'the <Tt> tooltip-attribute helper stays wired to useT',
    needs: ['export function Tt', 'useT'],
  },
  // Flagship coverage: representative high-traffic surfaces must keep
  // importing the translator, so the wrapping can't be wholesale removed.
  {
    file: 'app/counsel/page.tsx',
    label: 'the counsel dashboard still imports the translator',
    needs: [IMPORT],
  },
  {
    file: 'app/counsel/clients/page.tsx',
    label: 'the clients page still imports the translator',
    needs: [IMPORT],
  },
  {
    file: 'app/counsel/cases/page.tsx',
    label: 'the cases page still imports the translator',
    needs: [IMPORT],
  },
  {
    file: 'components/counsel/CounselDashboardTiles.tsx',
    label: 'the dashboard tiles still import the translator',
    needs: [IMPORT],
  },
  {
    file: 'components/Tabs.tsx',
    label: 'the shared Tabs still localizes its labels',
    needs: [IMPORT],
  },
  // The account panels the counsel routes REUSE rather than copy. They live
  // outside app/counsel, so nothing above would notice if their wrapping went
  // away, and the symptom is quiet: translated headings sitting over English
  // controls on half the account page. Outside a LocaleProvider these are a
  // pure passthrough, so the consumer profile is unaffected either way.
  {
    file: 'app/profile/avatar-upload.tsx',
    label: 'the shared avatar control still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'app/profile/mfa-settings.tsx',
    label: 'the shared two-factor panel still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'app/profile/phone-verify-form.tsx',
    label: 'the shared phone-verification panel still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'app/profile/account-actions.tsx',
    label: 'the shared data-rights panel still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'app/profile/api-tokens/tokens-panel.tsx',
    label: 'the shared tokens list still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'app/profile/api-tokens/new-token-form.tsx',
    label: 'the shared mint-a-token form still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'app/feedback/feedback-panel.tsx',
    label: 'the shared feedback history still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'app/feedback/feedback-form.tsx',
    label: 'the shared feedback form still localizes its copy',
    needs: [IMPORT],
  },
  {
    file: 'components/BiometricSettings.tsx',
    label: 'the shared biometric panel still localizes its copy',
    needs: [IMPORT],
  },
];

/* ---- Part 2: allowlist of static `<T>{expr}</T>` expressions ----
 * Normalized (whitespace collapsed). Every entry has been human-verified to
 * wrap a STATIC value: a component prop whose callers all pass literals, a
 * map param over a static array, a constant-map lookup, or a literal ternary.
 * Adding an entry is an explicit acknowledgement that it is NOT dynamic data.
 */
const ALLOWED_DYNAMIC_WRAPS = new Set([
  // component props (all call sites pass static literals)
  'label',
  'title',
  'eyebrow',
  'body',
  'description',
  'helper',
  'hint',
  // `blurb: string` on the four matter tiles (SectionPanel, the two NavTiles,
  // ExportPacketTile). Every call site of all four passes a literal.
  'blurb',
  // `qualifier: string` on ReportCard - the period or the sort a card's
  // contents are taken over ("30 days", "12 weeks", "Oldest first"). Every
  // value is a literal or a template over REPORT_WINDOW_DAYS /
  // REPORT_WEEKS in lib/counsel-reports.ts. It is a separate prop from
  // `title` precisely so a card cannot state a figure without stating the
  // window it was taken over, so it is UI copy by construction.
  'qualifier',
  // `state: string` on the dashboard metric board's MetricCell - the word
  // that carries a metric's urgency so the tone is never colour alone
  // ("Needs a decision", "Awaiting signers", "Queue clear"). Every value
  // comes from the `activeState` / `clearState` literals in
  // lib/counsel-metrics.ts; nothing on that board is firm data, and the
  // figures themselves are rendered outside <T>.
  'state',
  // The per-type vocabulary (lib/firm-vocabulary.ts). `vocab` is a lookup into
  // FIRM_VOCABULARY, a frozen constant map of six literal-valued records keyed
  // by FirmType - the noun a workspace of that type uses for a concept
  // ("Clients" or "Employees", "New intake" or "New request"). It is UI copy
  // chosen by a stored enum, never firm data: no name, title, amount or status
  // can reach it, because nothing writes into that map at runtime. A
  // FirmVocabulary field is exactly the same kind of value as the `state`
  // literals above, arrived at the same way.
  // The workflow-state label (WORKFLOW_LABEL in lib/intake-workflow.ts). Same
  // argument as `state` above: a frozen constant map of nine literal labels
  // keyed by the workflow enum, naming what is happening with a ticket
  // ("Awaiting external party", "Completed"). Nothing writes into that map at
  // runtime, so no requester name, subject or figure can reach the wrap. The
  // ticket's own title and the requester's name are rendered outside it,
  // marked data-no-translate.
  'WORKFLOW_LABEL[workflow]',
  // The request queue's tab names (INTAKE_LIST_VIEW_LABEL in lib/intake-list.ts).
  // Reviewed on the same grounds as WORKFLOW_LABEL directly above: a frozen
  // constant map of seven literal labels keyed by the view enum ("All open",
  // "Awaiting others", "Everything"), which nothing writes into at runtime, so
  // no requester name, subject, reference or figure can reach the wrap. The
  // count beside each label is rendered outside it by ViewStrip, and every
  // piece of firm data in the table below carries data-no-translate.
  'INTAKE_LIST_VIEW_LABEL[key]',
  // The approvals queue's direction facet (DIRECTION_FACET_LABEL in
  // lib/approval-queue.ts). Reviewed on exactly the grounds of the two
  // entries above: a frozen constant map of three literal labels keyed by the
  // facet enum ("Everything", "We are asking them to sign", "They are asking
  // us to sign"), which nothing writes into at runtime, so no document name,
  // party name, reference or figure can reach the wrap. The count beside each
  // label is rendered outside it by ViewStrip, and every piece of firm data
  // on the rows below carries data-no-translate.
  'DIRECTION_FACET_LABEL[key]',
  // What approving does, in the words that fit the direction now selected
  // (QUEUE_FRAMING in lib/approval-queue.ts). Reviewed on the same grounds as
  // the entry directly above and drawn from the same module: a frozen
  // constant map of two records whose fields are literal sentences, keyed by
  // the direction enum. Nothing writes into it at runtime, so no document
  // name, party name or figure can reach the wrap, and it renders only when
  // the reviewer has narrowed the facet to one direction.
  'QUEUE_FRAMING[params.dir].decision',
  // The inbound authorisation heading (INBOUND_AUTHORIZE_HEADING in
  // lib/signing-authorization.ts). A single frozen string constant,
  // "Authorise this signature", with nothing interpolated into it and nothing
  // writing to it at runtime. It is a constant rather than an inline literal
  // so the copy the owner specified is testable without a DOM. The two
  // sentences under it in that panel carry party names and are deliberately
  // NOT wrapped: they are marked data-no-translate instead.
  'INBOUND_AUTHORIZE_HEADING',
  'vocab.clients',
  'vocab.client',
  'vocab.intake',
  'vocab.practiceAreas',
  'vocab.caseload',
  'vocab.directory',
  // The per-type COPY DECK (FIRM_COPY in the same module). Same argument as
  // the vocabulary above, one level up: where `vocab.*` is a noun, `copy.*` is
  // a whole sentence, written out twice in full because a noun substituted
  // into running copy breaks the article, the case, and the dictionary lookup
  // that makes `<T>` work at all. FIRM_COPY is a frozen constant map of
  // literal-valued records keyed by FirmType. Nothing writes into it at
  // runtime, so no firm name, client name or figure can reach these wraps.
  //
  // The ternary is over two fields of that same map (singular / plural noun
  // phrase); the count that selects between them is rendered outside the wrap.
  'copy.rosterTitle',
  'copy.rosterBlurb',
  'copy.rosterEmpty',
  'copy.rosterEmptyCanInvite',
  'copy.rosterEmptyCannotInvite',
  'clients.length === 1 ? copy.rosterCountOne : copy.rosterCountMany',
  'data.copy.assignedRoster',
  'data.copy.assignedRosterEmpty',
  'data.copy.assignedCasesEmpty',
  'data.copy.assignedNothing',
  'copy.inviteHeading',
  'copy.intakeEyebrow',
  'copy.intakeBlurb',
  // The signature-direction question and its three answers
  // (lib/intake-signature-direction.ts), and the attachment field's inbound
  // wording. Every one is a module-level string constant or a field of
  // SIGNATURE_DIRECTION_CHOICES, a frozen literal array. Nothing writes into
  // them at runtime, so no request title, requester name or attachment name
  // can reach these wraps; the person's own data on that form is rendered
  // outside them.
  'SIGNATURE_DIRECTION_QUESTION',
  'choice.label',
  'INBOUND_ATTACHMENT_LABEL',
  'INBOUND_ATTACHMENT_HELP',
  // The chip on the request queue and on the ticket. signatureDirectionLabel
  // returns one of two literals or null, chosen by an enum read out of
  // intake_answers, and the null case renders no chip at all. Same family as
  // WORKFLOW_LABEL above: a fixed label selected by a stored enum.
  'directionLabel',
  // The template step's own copy (lib/intake-template-picker.ts): three module
  // constants, plus deliveryModeLabel, which returns one of two literals for
  // the DeliveryMode enum. The template's NAME and DESCRIPTION are firm data
  // and are rendered outside these wraps, marked data-no-translate.
  'TEMPLATE_STEP_QUESTION',
  'TEMPLATE_STEP_HELP',
  'TEMPLATE_STEP_EMPTY',
  'deliveryModeLabel(selected.deliveryMode)',
  'deliveryModeLabel(tpl.deliveryMode)',
  // static-array .map() params
  'l',
  's',
  'p',
  'c',
  'i',
  'at',
  // render-site label props over static arrays / objects
  'a.label',
  // `recordFacts` on the counsel request detail. Reviewed on the same grounds
  // as the rest of this family: the five labels are hard-coded literals in
  // app/counsel/intake/[id]/page.tsx ('Type', 'Jurisdiction', 'Request type',
  // 'Confidentiality', 'Expiry'). Only the label is wrapped; the VALUE beside
  // it is request data and is rendered outside the wrap, marked
  // data-no-translate.
  'f.label',
  'l.label',
  'm.label',
  'r.label',
  't.label',
  'tg.label',
  'item.label',
  'activeTab.label',
  'it.detail',
  'c.name',
  'sec.section',
  // CounselGuestNav's tab strip. The array is built in the component from
  // four string literals; the Folders tab is CONDITIONAL on a fetched folder
  // list but its label is still the literal 'Folders', never a folder name.
  'it.label',
  // constant-map lookups (static enum -> UI label/hint maps)
  'STATUS_HINT[s]',
  'FIRM_ROLE_DESCRIPTION[r]',
  'FIRM_ROLE_LABEL[membership.role]',
  'SCIM_STATE_LABEL[state]',
  // a local whose every branch is a string literal
  // (party-profile-card: isBusiness ? 'Entity' : isPerson ? 'Individual' : 'Subject')
  'classification',
  // pluralization / choice ternaries whose branches are all string literals
  "emptyMessage ?? 'No requests here yet.'",
  "allDocs.length === 1 ? 'document' : 'documents'",
  "data.counts.members === 1 ? 'member' : 'members'",
  // The action center's headline, now a named function over a number rather
  // than a ternary inline in the JSX. Both of its branches are string
  // literals in components/counsel/CounselDashboardTiles.tsx and its only
  // argument is a count, so nothing a firm typed can reach the translator.
  'actionCenterHeadline(workItems)',
  "total === 1 ? 'thing in your name' : 'things in your name'",
  "preview.totalRows === 1 ? 'client' : 'clients'",
  "preview.totalRows === 1 ? 'case' : 'cases'",
  "result.casesCreated === 1 ? 'matter' : 'matters'",
  "result.attachmentsCreated === 1 ? 'attachment' : 'attachments'",
  "failures.length === 1 ? 'failure - expand to inspect' : 'failures - expand to inspect'",
  "e.attachments === 1 ? 'file' : 'files'",
  "e.attachments === 1 ? 'attachment' : 'attachments'",
  "isBusiness ? 'Opposing party (business)' : 'Opposing party'",
]);

// Directories / files to scan for braced <T> wraps.
const SCAN_DIRS = ['app/counsel', 'components/counsel'];
const SCAN_FILES = ['components/Tabs.tsx'];
const BRACED_T = /<T>\s*\{([\s\S]*?)\}\s*<\/T>/g;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(join(root, dir));
  } catch {
    return out;
  }
  for (const name of entries) {
    const rel = join(dir, name);
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

let failures = 0;

// Part 1
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

// Part 2
const files = [...SCAN_FILES, ...SCAN_DIRS.flatMap((d) => walk(d, []))];
const violations = [];
for (const file of files) {
  let src;
  try {
    src = readFileSync(join(root, file), 'utf8');
  } catch {
    continue;
  }
  let m;
  BRACED_T.lastIndex = 0;
  while ((m = BRACED_T.exec(src))) {
    const expr = m[1].replace(/\s+/g, ' ').trim();
    if (!ALLOWED_DYNAMIC_WRAPS.has(expr)) {
      violations.push({ file, line: lineOf(src, m.index), expr });
    }
  }
}

if (violations.length > 0) {
  failures += violations.length;
  console.error(
    '\n✗ unreviewed `<T>{expr}</T>` wrap(s) - confirm each wraps a STATIC value\n' +
      '  (a fixed label/enum/literal, never DB or user data), then add its\n' +
      '  normalized form to ALLOWED_DYNAMIC_WRAPS in this script:',
  );
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  <T>{${v.expr}}</T>`);
  }
} else {
  console.log(
    `✓ all ${files.length ? 'counsel' : ''} braced <T> wraps are on the static allowlist`,
  );
}

if (failures > 0) {
  console.error(
    `\ncounsel i18n invariant guard FAILED: ${failures} check(s) regressed.`,
  );
  process.exit(1);
}
console.log('\nAll counsel i18n invariants hold.');
