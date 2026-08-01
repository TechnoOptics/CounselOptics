# Intake Form Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a firm's legal team build, version and publish their own legal intake forms, rendered on Advottic's employee Hub and projected to partner apps, with v1 proven end to end on the `nda` request type.

**Architecture:** Three tables hold identity and versions; the whole question tree lives as one validated JSONB payload per version. A single shared schema module defines the payload and validates it, so the builder, both renderers, the answer validator and the partner projection cannot drift. Submissions bind to the version they were filled on.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase (Postgres + RLS), vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-intake-form-builder-design.md`. Read it before Task 1.

## Global Constraints

- **No em dashes** anywhere: code, comments, UI copy, seed data, docs. Use commas, periods, parentheses, colons or hyphens.
- **No emoji** in UI chrome or as icons. Icons are clean stroke SVGs. Follow `CalendarIcon` / `DocumentIcon` in `app/counsel/intake/[id]/page.tsx`.
- **Tone:** calm, plain, professional. Users are employees raising legal problems at work.
- **No new dependencies.** `zod` is not installed and must not be added. Hand-roll validation following the existing pattern in `lib/partner-config-core.ts` `readPartnerConfig`: coerce, clamp, drop invalid entries, never throw on read.
- **Every `'use server'` export is a public HTTP endpoint.** Privileged helpers belong in `import 'server-only'` modules, never in a `'use server'` file. See `lib/intake-notify.ts` for the established split.
- **Authorization** uses `lib/firm-authz.ts` (`callerFirmRole`, `callerIsFirmMember`, `callerHasFirmRole`). Do not write a fourth membership check.
- **The partner API response shape does not change.** `GET /api/partner/v1/config` must keep returning `{ ackMessage, questions: [{id, label, type: 'text'|'select'|'yesno', options?, required?}] }`. Additive optional fields only.
- **Tailwind scans `./lib/**`** as well as app and components. A style map placed in `lib/` works, but do not rely on class strings assembled at runtime; Tailwind cannot see those.
- Run `npx tsc --noEmit` and `npm run build` before every commit.

---

## File Structure

**New, pure logic (no I/O, fully unit tested):**
- `lib/form-schema.ts` - payload types, `validateFormPayload`, `readFormPayload`
- `lib/form-validate.ts` - `isQuestionVisible`, `validateAnswers`
- `lib/form-to-partner.ts` - `projectToPartnerQuestions`

**New, data access (server-only):**
- `lib/form-queries.ts` - reads for types, forms, versions
- `lib/form-actions.ts` - `'use server'` actions: save draft, publish, request-type CRUD

**New, UI:**
- `components/forms/FormRenderer.tsx` - renders a payload, shared by both surfaces
- `components/forms/fields/` - one file per question type input
- `app/counsel/settings/forms/page.tsx` - request type list
- `app/counsel/settings/forms/[typeId]/page.tsx` - builder shell
- `app/counsel/settings/forms/[typeId]/builder-client.tsx` - the builder

**New, migration:**
- `supabase/migrations/20260801_intake_form_builder.sql`

**Modified:**
- `app/portal/new/page.tsx` - mount `FormRenderer` when a form is published
- `app/counsel/intake/create-intake-form.tsx` - same, plus read request types from the table
- `lib/partner-tickets.ts` - serve the projection, validate arriving answers against the real payload
- `app/api/partner/v1/config/route.ts` - serve the projection

**Tests:**
- `tests/form-schema.test.ts`, `tests/form-validate.test.ts`, `tests/form-to-partner.test.ts`, `tests/form-publish.test.ts`

---

## Task 1: Payload schema and validator

**Files:**
- Create: `lib/form-schema.ts`
- Test: `tests/form-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FormPayload`, `Row`, `Question`, `QuestionType`, `Rule`, `QuestionConfig` types; `validateFormPayload(payload: unknown): { ok: true; payload: FormPayload } | { ok: false; errors: FormError[] }`; `readFormPayload(raw: unknown): FormPayload` (lenient read, never throws, for rendering stored rows); `EMPTY_PAYLOAD: FormPayload`. `FormError = { path: string; questionId?: string; message: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/form-schema.test.ts
import { describe, it, expect } from 'vitest';
import { validateFormPayload, readFormPayload, EMPTY_PAYLOAD } from '../lib/form-schema';

const q = (over: Record<string, unknown> = {}) => ({
  id: 'q1', key: 'counterparty', type: 'short_text',
  label: 'Counterparty name', required: false, config: {}, ...over,
});
const payload = (rows: unknown[]) => ({ schemaVersion: 1, rows });

describe('validateFormPayload', () => {
  it('accepts a minimal valid payload', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [q()] }]));
    expect(r.ok).toBe(true);
  });

  it('rejects a row with more than three fields', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [
      q({ id: 'a', key: 'a' }), q({ id: 'b', key: 'b' }),
      q({ id: 'c', key: 'c' }), q({ id: 'd', key: 'd' }),
    ] }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /one to three/i.test(e.message))).toBe(true);
  });

  it('rejects an empty row', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [] }]));
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate question keys', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'same' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'same' })] },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /unique/i.test(e.message))).toBe(true);
  });

  it('rejects a rule that references a later question', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'a', showWhen: { questionId: 'b', op: 'eq', value: 'Yes' } })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'b' })] },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /earlier/i.test(e.message))).toBe(true);
  });

  it('rejects a rule referencing a question that does not exist', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ showWhen: { questionId: 'nope', op: 'eq', value: 'Yes' } })] },
    ]));
    expect(r.ok).toBe(false);
  });

  it('rejects eq without a value', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'b', showWhen: { questionId: 'a', op: 'eq' } })] },
    ]));
    expect(r.ok).toBe(false);
  });

  it('accepts answered without a value', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]));
    expect(r.ok).toBe(true);
  });

  it('rejects a select with no options', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ type: 'select', config: { options: [] } })] },
    ]));
    expect(r.ok).toBe(false);
  });

  it('rejects an empty label', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [q({ label: '  ' })] }]));
    expect(r.ok).toBe(false);
  });

  it('reports every problem, not just the first', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'dup', label: '' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'dup' })] },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(1);
  });
});

describe('readFormPayload', () => {
  it('returns an empty payload for junk rather than throwing', () => {
    expect(readFormPayload(null)).toEqual(EMPTY_PAYLOAD);
    expect(readFormPayload('nonsense')).toEqual(EMPTY_PAYLOAD);
    expect(readFormPayload({ rows: 'no' })).toEqual(EMPTY_PAYLOAD);
  });

  it('drops invalid fields but keeps valid ones', () => {
    const out = readFormPayload(payload([
      { id: 'r1', fields: [q(), { id: 'x', label: '' }] },
    ]));
    expect(out.rows[0].fields).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/form-schema.test.ts`
Expected: FAIL, cannot resolve `../lib/form-schema`.

- [ ] **Step 3: Implement `lib/form-schema.ts`**

Write the module so every test above passes. Requirements, all load-bearing:

- `QUESTION_TYPES` is an exported readonly array of exactly: `short_text`, `long_text`, `email`, `phone`, `number`, `currency`, `date`, `time`, `datetime`, `yesno`, `select`, `multiselect`.
- `validateFormPayload` collects **all** errors and returns them together. It never throws. A single-error-and-stop validator makes the builder's publish dialog useless.
- Rule ordering is checked by walking rows in order, building a set of question ids already seen, and requiring `showWhen.questionId` to be in that set. This enforces "earlier" and rules out cycles in one pass.
- `readFormPayload` is the lenient counterpart, modelled on `readPartnerConfig`: it coerces, drops anything invalid, and always returns a usable `FormPayload`. It exists so a stored version can always render even if it somehow drifted.
- Caps: label 200 chars, help 500, options 100 entries, 60 questions per form, 40 rows.
- No em dashes in any message string.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/form-schema.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add lib/form-schema.ts tests/form-schema.test.ts
git commit -m "Add intake form payload schema and validator

Collects every error rather than stopping at the first, because the
builder's publish dialog lists them all as links to the offending field.
Rule ordering is enforced by a single forward walk, which is what makes
cycles impossible rather than merely unlikely.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Rule evaluation and answer validation

**Files:**
- Create: `lib/form-validate.ts`
- Test: `tests/form-validate.test.ts`

**Interfaces:**
- Consumes: `FormPayload`, `Question`, `Rule` from `lib/form-schema`.
- Produces: `type Answers = Record<string, string | string[]>` (keyed by question `key`); `isQuestionVisible(q: Question, payload: FormPayload, answers: Answers): boolean`; `validateAnswers(payload: FormPayload, answers: Answers): { ok: true } | { ok: false; errors: Record<string, string> }` where the error map is keyed by question `key`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/form-validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateAnswers, isQuestionVisible } from '../lib/form-validate';
import type { FormPayload } from '../lib/form-schema';

const form: FormPayload = {
  schemaVersion: 1,
  rows: [
    { id: 'r1', fields: [
      { id: 'a', key: 'has_counterparty', type: 'yesno', label: 'Is there a counterparty?',
        required: true, config: {} },
    ] },
    { id: 'r2', fields: [
      { id: 'b', key: 'counterparty', type: 'short_text', label: 'Counterparty name',
        required: true, config: {}, showWhen: { questionId: 'a', op: 'eq', value: 'Yes' } },
    ] },
    { id: 'r3', fields: [
      { id: 'c', key: 'value', type: 'currency', label: 'Contract value',
        required: false, config: { currency: 'USD', min: 0 } },
      { id: 'd', key: 'summary', type: 'long_text', label: 'Summary',
        required: false, config: { maxWords: 5 } },
      { id: 'e', key: 'term', type: 'number', label: 'Term in months',
        required: false, config: { min: 1, max: 60 } },
    ] },
  ],
};

describe('a hidden question is not required', () => {
  it('submits cleanly when the controlling answer hides a required question', () => {
    const r = validateAnswers(form, { has_counterparty: 'No' });
    expect(r.ok).toBe(true);
  });

  it('requires it once the controlling answer reveals it', () => {
    const r = validateAnswers(form, { has_counterparty: 'Yes' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.counterparty).toBeTruthy();
  });

  it('accepts it when revealed and answered', () => {
    const r = validateAnswers(form, { has_counterparty: 'Yes', counterparty: 'Acme' });
    expect(r.ok).toBe(true);
  });
});

describe('isQuestionVisible', () => {
  const q = (id: string) => form.rows.flatMap((r) => r.fields).find((f) => f.id === id)!;

  it('eq matches and does not match', () => {
    expect(isQuestionVisible(q('b'), form, { has_counterparty: 'Yes' })).toBe(true);
    expect(isQuestionVisible(q('b'), form, { has_counterparty: 'No' })).toBe(false);
  });

  it('treats an unanswered controller as not matching', () => {
    expect(isQuestionVisible(q('b'), form, {})).toBe(false);
  });

  it('a question with no rule is always visible', () => {
    expect(isQuestionVisible(q('a'), form, {})).toBe(true);
  });
});

describe('per type constraints', () => {
  const base = { has_counterparty: 'No' };

  it('enforces maxWords on long text', () => {
    const r = validateAnswers(form, { ...base, summary: 'one two three four five six' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.summary).toMatch(/5 words/);
  });

  it('accepts long text at the limit', () => {
    expect(validateAnswers(form, { ...base, summary: 'one two three four five' }).ok).toBe(true);
  });

  it('enforces number min and max', () => {
    expect(validateAnswers(form, { ...base, term: '0' }).ok).toBe(false);
    expect(validateAnswers(form, { ...base, term: '61' }).ok).toBe(false);
    expect(validateAnswers(form, { ...base, term: '12' }).ok).toBe(true);
  });

  it('rejects a non-numeric number', () => {
    expect(validateAnswers(form, { ...base, term: 'twelve' }).ok).toBe(false);
  });

  it('rejects negative currency when min is zero', () => {
    expect(validateAnswers(form, { ...base, value: '-5' }).ok).toBe(false);
  });

  it('rejects sub-cent currency rather than rounding it silently', () => {
    expect(validateAnswers(form, { ...base, value: '1.005' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/form-validate.test.ts`
Expected: FAIL, cannot resolve `../lib/form-validate`.

- [ ] **Step 3: Implement `lib/form-validate.ts`**

Requirements:

- `validateAnswers` evaluates **visibility first, then requiredness**, and skips every hidden question entirely, including its type constraints. This is the single most important behaviour in the feature: a required question the employee was never shown must not block submission.
- Rules evaluate against the question `key` of the controller, resolved from `questionId` via the payload.
- Currency parsing rejects more than two decimal places rather than rounding. The trust-accounting work in this codebase found that `Math.round(Number(s) * 100)` rounds sub-cent input inconsistently (`1.005` down, `100.005` up), so silent rounding is a known-bad pattern here.
- Error messages are calm and name the limit, for example `Use 5 words or fewer.` No em dashes.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/form-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add lib/form-validate.ts tests/form-validate.test.ts
git commit -m "Add rule evaluation and answer validation for intake forms

Visibility is evaluated before requiredness, so a required question the
employee was never shown cannot block their submission. Both the renderer
and the submit action import this, because a rule enforced only in the
browser is not enforced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Partner projection

**Files:**
- Create: `lib/form-to-partner.ts`
- Test: `tests/form-to-partner.test.ts`

**Interfaces:**
- Consumes: `FormPayload`, `Question` from `lib/form-schema`; `PartnerQuestion` from `lib/partner-config-core`.
- Produces: `projectToPartnerQuestions(payload: FormPayload): PartnerQuestion[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/form-to-partner.test.ts
import { describe, it, expect } from 'vitest';
import { projectToPartnerQuestions } from '../lib/form-to-partner';
import { QUESTION_TYPES, type FormPayload } from '../lib/form-schema';

const one = (over: Record<string, unknown>): FormPayload => ({
  schemaVersion: 1,
  rows: [{ id: 'r1', fields: [{
    id: 'a', key: 'a', type: 'short_text', label: 'A', required: false, config: {}, ...over,
  } as never] }],
});

describe('projectToPartnerQuestions', () => {
  it('flattens rows into one ordered list', () => {
    const out = projectToPartnerQuestions({ schemaVersion: 1, rows: [
      { id: 'r1', fields: [
        { id: 'a', key: 'a', type: 'short_text', label: 'A', required: false, config: {} },
        { id: 'b', key: 'b', type: 'short_text', label: 'B', required: false, config: {} },
      ] },
      { id: 'r2', fields: [
        { id: 'c', key: 'c', type: 'short_text', label: 'C', required: false, config: {} },
      ] },
    ] });
    expect(out.map((q) => q.label)).toEqual(['A', 'B', 'C']);
  });

  it('emits a conditional question unconditionally and never required', () => {
    const out = projectToPartnerQuestions({ schemaVersion: 1, rows: [
      { id: 'r1', fields: [
        { id: 'a', key: 'a', type: 'yesno', label: 'A', required: true, config: {} },
      ] },
      { id: 'r2', fields: [
        { id: 'b', key: 'b', type: 'short_text', label: 'B', required: true, config: {},
          showWhen: { questionId: 'a', op: 'eq', value: 'Yes' } },
      ] },
    ] });
    expect(out).toHaveLength(2);
    expect(out[1].required).toBe(false);
  });

  it('maps multiselect to select and keeps its options', () => {
    const out = projectToPartnerQuestions(one({
      type: 'multiselect', config: { options: ['X', 'Y'] },
    }));
    expect(out[0].type).toBe('select');
    expect(out[0].options).toEqual(['X', 'Y']);
  });

  it('maps yesno to yesno and select to select', () => {
    expect(projectToPartnerQuestions(one({ type: 'yesno', config: {} }))[0].type).toBe('yesno');
    expect(projectToPartnerQuestions(one({
      type: 'select', config: { options: ['X'] },
    }))[0].type).toBe('select');
  });

  it('maps every other type to text', () => {
    for (const t of QUESTION_TYPES) {
      if (t === 'yesno' || t === 'select' || t === 'multiselect') continue;
      const cfg = t === 'currency' ? { currency: 'USD' } : {};
      expect(projectToPartnerQuestions(one({ type: t, config: cfg }))[0].type).toBe('text');
    }
  });

  it('produces a type every partner app understands, for every question type', () => {
    const allowed = new Set(['text', 'select', 'yesno']);
    for (const t of QUESTION_TYPES) {
      const cfg = t === 'select' || t === 'multiselect'
        ? { options: ['X'] } : t === 'currency' ? { currency: 'USD' } : {};
      expect(allowed.has(projectToPartnerQuestions(one({ type: t, config: cfg }))[0].type)).toBe(true);
    }
  });

  it('uses the question key as the partner id, so answers can be matched back', () => {
    expect(projectToPartnerQuestions(one({ key: 'counterparty' }))[0].id).toBe('counterparty');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/form-to-partner.test.ts`
Expected: FAIL, cannot resolve `../lib/form-to-partner`.

- [ ] **Step 3: Implement `lib/form-to-partner.ts`**

Requirements:

- The exhaustive test above is the important one: it iterates `QUESTION_TYPES`, so adding a thirteenth type later fails this test until its mapping is decided. That is deliberate.
- Partner `id` is the question `key`, not the question `id`, because `resolveQuestionAnswers` matches arriving answers by that id and `key` is what answers are stored against on our side.
- Conditional questions are emitted with `required: false` regardless of their own setting, and their real requiredness is enforced on arrival in Task 9.
- Constraints (`maxWords`, `min`, `max`, `currency`) do not survive the projection; that is expected, and Task 9 enforces them server-side.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/form-to-partner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add lib/form-to-partner.ts tests/form-to-partner.test.ts
git commit -m "Project a form payload down to the partner question contract

Zinpro's shipped app understands text, select and yesno only, so every
question type must map onto those three. The exhaustive test over
QUESTION_TYPES fails when a new type is added without deciding its
mapping, which is the point.

Conditional questions are emitted unconditionally and never required: they
have to appear or a partner-app employee can never supply them, and they
cannot be required or that employee is blocked by a question that may not
apply.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Migration, tables, RLS and backfill

**Files:**
- Create: `supabase/migrations/20260801_intake_form_builder.sql`
- Test: manual verification queries, listed in the steps.

**Interfaces:**
- Produces: tables `firm_request_types`, `firm_intake_forms`, `firm_intake_form_versions`; column `firm_matter_intakes.form_version_id`.

**Read first:** `supabase/migrations/20260731_staff_role_read_scope.sql` for the documentation style this repo expects on a migration, including a "who is affected" section and the pre-apply verification query.

- [ ] **Step 1: Write the migration**

Tables exactly as specified in the spec's data model section. Then:

**RLS**, mirroring `lib/firm-authz.ts` role sets:
- SELECT on all three tables: any row in `firm_members` for that firm.
- INSERT, UPDATE, DELETE: role in `('owner', 'admin', 'attorney')`.
- Helper predicates go in the `private` schema, following this repo's convention. **Order matters**: create tables, then helpers, then policies. Postgres validates function bodies at CREATE time, and a helper referencing a table that does not exist yet fails.

**Backfill**, two sources as the spec describes:
- The hardcoded 12 from `app/counsel/intake/create-intake-form.tsx`, per firm, `key` = slug of the value string, `label` = value string verbatim, `mode` preserved.
- One type per distinct `matter_type` observed on partner-filed intakes for that firm (`intake_answers->'partner'->>'externalId' is not null`), `key` = the slug verbatim, `label` = humanised.

**Do not** auto-merge near duplicates such as `nda` and `nda_review`.

- [ ] **Step 2: Verify the backfill against live data before applying**

Run through the Supabase MCP, read-only:

```sql
select i.matter_type, (i.intake_answers->'partner'->>'externalId') is not null as via_partner,
       count(*) from public.firm_matter_intakes i group by 1,2 order by 3 desc;
```

Expected today: `nda`, `hr`, `contract-review`, `incident` all `via_partner = true`, plus `Document for safekeeping` with `via_partner = false`. Confirm the migration's backfill would produce a type for each.

- [ ] **Step 3: Apply the migration**

Use the Supabase MCP `apply_migration`. **Stop and ask the owner first** if the affected-row counts differ from Step 2. This repo's convention is that policy changes are verified against live counts immediately before applying.

- [ ] **Step 4: Verify after applying**

```sql
select key, label, mode from public.firm_request_types order by firm_id, sort_order;
select count(*) from public.firm_intake_forms;          -- expect 0
select count(*) from public.firm_intake_form_versions;  -- expect 0
```

Expect types for every firm, zero forms and zero versions. **Behaviour must be unchanged for every firm at this point**, because nothing reads the new tables yet.

- [ ] **Step 5: Regenerate the schema fingerprint and commit**

The CI drift gate hashes the live schema against `supabase/schema-fingerprint.sha256`. It fails if the hash is stale after any migration.

```bash
git add supabase/migrations/20260801_intake_form_builder.sql supabase/schema-fingerprint.sha256
git commit -m "Add intake form builder tables, RLS and request type backfill

Backfilled from two vocabularies, because two already exist in the data:
the hardcoded 12 (matched by label, which is what Advottic-filed intakes
store) and the partner's own slugs (matched by key, which is what arrives
in matter_type). Near duplicates such as nda and nda_review are not
merged, because merging guesses at intent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Queries and server actions

**Files:**
- Create: `lib/form-queries.ts` (add `import 'server-only'` as the first line)
- Create: `lib/form-actions.ts` (`'use server'`)
- Test: `tests/form-publish.test.ts`

**Interfaces:**
- Consumes: `validateFormPayload`, `readFormPayload`, `EMPTY_PAYLOAD` from `lib/form-schema`; `callerHasFirmRole` from `lib/firm-authz`.
- Produces, from `lib/form-queries.ts`: `listRequestTypes(admin, firmId)`, `getFormForType(admin, firmId, typeId)`, `getPublishedPayload(admin, firmId, typeKey)` returning `{ payload: FormPayload; versionId: string } | null`.
- Produces, from `lib/form-actions.ts`: `saveDraftAction(typeId: string, payload: unknown)`, `publishFormAction(typeId: string)`, `discardDraftAction(typeId: string)`, `upsertRequestTypeAction(input)`, `hideRequestTypeAction(typeId, hidden: boolean)`. All return `{ ok: true } | { ok: false; error: string }` or, for publish, `{ ok: false; errors: FormError[] }`.

**Critical:** every export of a `'use server'` module is a public HTTP endpoint. Each action re-checks the caller's firm role with `callerHasFirmRole(firmId, ['owner','admin','attorney'])` and derives `firmId` from the type row, **never** from an argument. The authorization sweep in commit `237ea16e` closed nine holes of exactly this shape.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/form-publish.test.ts
import { describe, it, expect } from 'vitest';
import { validateFormPayload } from '../lib/form-schema';

// The publish gate is validate-then-write. These tests pin the gate itself;
// the database round trip is covered by the manual verification in Task 10.
describe('publish gate', () => {
  it('refuses a payload that fails validation', () => {
    const bad = { schemaVersion: 1, rows: [{ id: 'r1', fields: [] }] };
    expect(validateFormPayload(bad).ok).toBe(false);
  });

  it('accepts a payload that passes', () => {
    const good = { schemaVersion: 1, rows: [{ id: 'r1', fields: [{
      id: 'a', key: 'a', type: 'short_text', label: 'A', required: false, config: {},
    }] }] };
    expect(validateFormPayload(good).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it passes against Task 1's module**

Run: `npx vitest run tests/form-publish.test.ts`
Expected: PASS. This test guards the invariant that publish uses the same validator, so it must not be weakened later.

- [ ] **Step 3: Implement the queries and actions**

`publishFormAction` in order: resolve the type row and its `firm_id`; check the caller's role; read `draft_payload`; `validateFormPayload`; on failure return the errors unchanged so the builder can link to each field; on success compute `max(version) + 1` for that form, insert the version, then set `published_version_id` and clear `draft_payload` in the same statement.

`saveDraftAction` writes `draft_payload` without validating, because a draft is allowed to be incomplete.

- [ ] **Step 4: Type-check, build and commit**

```bash
npx tsc --noEmit && npm run build
git add lib/form-queries.ts lib/form-actions.ts tests/form-publish.test.ts
git commit -m "Add form queries and publish actions

firmId is derived from the type row, never taken from an argument, because
every export of a use-server module is a public HTTP endpoint. Publish
runs the same validator the builder does and returns its errors unchanged
so each one can link to the field that caused it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: FormRenderer

**Files:**
- Create: `components/forms/FormRenderer.tsx`
- Create: `components/forms/fields/` (one component per question type)

**Interfaces:**
- Consumes: `FormPayload` from `lib/form-schema`; `isQuestionVisible`, `validateAnswers`, `Answers` from `lib/form-validate`.
- Produces: `<FormRenderer payload answers onChange errors readOnly? />`.

- [ ] **Step 1: Build the renderer**

- Rows render as a grid: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`, each field spanning `1`, with a one-field row spanning full width. On mobile every field is full width.
- Hidden questions are **not rendered at all**, not rendered disabled. `isQuestionVisible` is the only source of that decision.
- Errors render beneath their field, keyed by question `key`.
- Every input has a label bound by `htmlFor`, and required fields are marked with `aria-required`.
- `readOnly` renders answers as text, for the counsel intake view.

- [ ] **Step 2: Verify in the browser**

Mount it on a scratch route with the NDA payload from Task 2's test. Check at 390px and at desktop, in both themes if the surface supports them. Confirm: answering "No" to the counterparty question removes the dependent field entirely, and answering "Yes" restores it.

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit && npm run build
git add components/forms
git commit -m "Add the shared intake form renderer

One renderer for the employee Hub and the counsel create form, because two
implementations drift and the drift shows up as an employee seeing a
different form from the one legal built. Hidden questions are not rendered
at all rather than rendered disabled.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The builder

**Files:**
- Create: `app/counsel/settings/forms/page.tsx`
- Create: `app/counsel/settings/forms/[typeId]/page.tsx`
- Create: `app/counsel/settings/forms/[typeId]/builder-client.tsx`

**Interfaces:**
- Consumes: `listRequestTypes`, `getFormForType` from `lib/form-queries`; `saveDraftAction`, `publishFormAction`, `discardDraftAction` from `lib/form-actions`; `FormRenderer` for preview.

- [ ] **Step 1: Build the index page**

Request types listed with each form's state: no form yet, draft, or published v3. Use `PageHeader` and `EmptyState` from `components/counsel/ui.tsx`; do not hand-roll another page header, there are already 37 of those in this codebase.

- [ ] **Step 2: Build the canvas**

Rows top to bottom, each showing its fields plus a dashed empty slot where there is room. Clicking an empty slot opens the type picker **in place**, occupying the slot. Choosing a type materialises the field with its label input focused.

Clicking a field expands it in place for label, help, required and the type's own settings. One field expanded at a time.

- [ ] **Step 3: Build the rule editor**

Phrased as a sentence: *Show this only when* `[question]` `[is / is not / has any answer]` `[value]`. The question dropdown lists **only questions above this one**. A field whose rule points at a later question shows an inline problem and blocks publish, naming both questions.

- [ ] **Step 4: Wire autosave, preview and publish**

Autosave the draft on change, debounced. Header shows the draft's last-saved time and the published version. Preview renders the draft through `FormRenderer`, the real one. Publish calls the action and, on failure, lists each error as a button that scrolls to and focuses the field.

The publish confirmation states plainly: **publishing does not change requests already submitted.**

Show a warning when the form uses types older partner apps cannot render (anything other than `short_text`, `select`, `yesno`), listing how each degrades.

- [ ] **Step 5: Keyboard support**

Every field gets move up, down, left, right via keyboard, not drag only. A builder that only works with a mouse fails the accessibility bar applied elsewhere in this codebase.

- [ ] **Step 6: Verify in the browser and commit**

Build a real NDA form end to end, publish it, confirm the version row exists. Then:

```bash
npx tsc --noEmit && npm run build
git add app/counsel/settings/forms
git commit -m "Add the intake form builder

The canvas is the form: legal edits something that looks like what an
employee fills, rather than a properties panel beside a preview. The rule
editor lists only earlier questions, which teaches the no-forward-reference
invariant rather than enforcing it with an error after the fact.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Wire the two intake surfaces

**Files:**
- Modify: `app/portal/new/page.tsx`
- Modify: `app/counsel/intake/create-intake-form.tsx`

- [ ] **Step 1: Read request types from the table**

Replace the hardcoded `REQUEST_TYPES` array with `listRequestTypes`. Keep `mode` driving the same behaviour it drives today; that distinction decides whether a request is an outside-client matter or an internal one and must not be lost.

- [ ] **Step 2: Render the published form when there is one**

On type selection, look up the published payload via `getPublishedPayload`. If present, mount `FormRenderer`. If absent, render today's fixed fields unchanged.

- [ ] **Step 3: Validate on submit, server-side**

The submit action calls `validateAnswers` with the same payload. Store `form_version_id` on the intake, and keep writing `intake_answers.questionAnswers` in its existing `{id, label, value}` shape so the counsel intake page keeps rendering for intakes that predate this.

- [ ] **Step 4: Verify and commit**

File a request through `/portal/new` against a published NDA form. Confirm the intake row carries `form_version_id` and the answers render on the counsel side.

```bash
npx tsc --noEmit && npm run build
git add app/portal/new app/counsel/intake/create-intake-form.tsx
git commit -m "Render published intake forms on both intake surfaces

Falls back to today's fixed fields where no form is published, so a firm
that never opens the builder sees no change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Partner API

**Files:**
- Modify: `app/api/partner/v1/config/route.ts`
- Modify: `lib/partner-tickets.ts`

- [ ] **Step 1: Serve the projection**

Where a form is published for the ticket's request type, serve `projectToPartnerQuestions(payload)`. Otherwise serve the existing `partnerIntegration.questions` unchanged. Add optional `formVersionId` to the response. **Do not change any existing field.**

- [ ] **Step 2: Enforce the real rules on arrival**

In `resolveQuestionAnswers`, when the ticket's type has a published form, validate the submitted answers with `validateAnswers` against the real payload, so constraints that did not survive the projection are enforced and conditional questions get their true requiredness. Return an error naming the question, as that function already does.

- [ ] **Step 3: Bind the version**

If the partner echoes `formVersionId`, bind the intake to it. If not, bind to whatever is published on arrival and record that the binding was inferred.

- [ ] **Step 4: Verify against a real ticket and commit**

Post a ticket through the partner API with the NDA type. Confirm the questions arrive projected, a constraint violation is rejected with a named error, and the intake carries `form_version_id`.

```bash
npx tsc --noEmit && npm run build
git add app/api/partner/v1/config lib/partner-tickets.ts
git commit -m "Serve built forms to partner apps and enforce their rules on arrival

The response shape is unchanged, so Zinpro's shipped app keeps parsing it.
Constraints do not survive the projection by design, so they are enforced
here instead, where the real payload is available.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Prove the loop, then document

- [ ] **Step 1: Run the whole loop**

In order, against the Zinpro firm and the `nda` type: build the form in the builder; publish it; file a request through `/portal/new`; confirm it renders on the counsel intake page bound to its version; fetch `/api/partner/v1/config` and confirm the projected questions; file a partner ticket and confirm its answers arrive validated.

**This is the definition of done from the spec.** Anything short of the whole loop is not done.

- [ ] **Step 2: Update the integration document**

Add the optional `formVersionId` to `docs/ZINPRO_INTEGRATION.md` **only if** Zinpro has confirmed they want it. Otherwise leave the document unchanged and note in the plan's completion that it was deliberately deferred.

- [ ] **Step 3: Final verification and commit**

```bash
npx tsc --noEmit && npm run build && npm test && npm run test:audit-guards
git add -A
git commit -m "Prove the intake form builder loop end to end on the nda type

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** Data model → Task 4. Payload schema and invariants → Task 1. Builder interaction → Task 7. Rendering and validation → Tasks 2, 6, 8. Partner projection → Tasks 3, 9. Permissions → Tasks 4, 5. Migration and compatibility → Task 4. Testing → Tasks 1, 2, 3, 5, 10. v1 scope and definition of done → Task 10.

**Deliberately deferred**, matching the spec's out-of-scope list: multiple conditions and AND/OR groups, file upload as a question type, per-question analytics, the `ZINPRO_INTEGRATION.md` contract change until Zinpro agrees, light mode, and QR mobile signing.

**Known gap.** Tasks 6, 7 and 8 are UI and are verified in the browser rather than by unit test. The logic they depend on is pure and fully tested in Tasks 1, 2 and 3, which is where the correctness risk actually sits.
