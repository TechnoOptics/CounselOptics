# Intake form builder

Design spec. Written 2026-08-01. Status: awaiting owner review.

## Goal

Let a firm's legal team build and maintain their own legal intake forms: add and
remove questions, choose data types, set validation, lay fields out up to three
per row, and keep a different form per type of legal request.

## v1 scope

**One request type, end to end: `nda`, for the Zinpro firm.**

The full machinery is built once, because the tables, schema, builder, renderer
and partner projection are all shared. What v1 constrains is how many request
types have a published form, and therefore how much has to be proved correct
before it is in front of anyone.

`nda` was chosen because it exercises nearly the whole feature honestly:
counterparty name (text), mutual or one-way (select), effective date (date),
term length (number), governing law (select), contract value (currency), and a
conditional driven by "is there a counterparty?". `hr` and `incident` are mostly
free text and would prove much less. The firm also already has an NDA template
in `firm_templates`, so this is the path with existing gravity.

**Done means:** legal builds the NDA form in the builder, publishes it, an
employee files an NDA request through `/portal/new` against it, Zinpro's app
receives the projected questions from `/api/partner/v1/config` and files a
ticket whose answers arrive validated, and the counsel intake page renders the
result bound to its version. Anything short of that whole loop is not done.

The other request types keep today's behaviour, which is the existing
`partnerIntegration.questions` list, until someone builds a form for them.

## Context: what exists today

Configurable intake questions already exist, in a narrower form than this spec
describes.

`lib/partner-config-core.ts` defines:

```ts
type PartnerQuestion = {
  id: string;
  label: string;
  type: 'text' | 'select' | 'yesno';
  options?: string[];
  required?: boolean;
};
```

They are stored schema-less in `firms.metadata.partnerIntegration.questions`,
capped at 12 questions and 12 options each, and edited from Counsel Settings
under "Partner app integration". They are served to partner apps by
`GET /api/partner/v1/config` and answered on ticket create, where
`resolveQuestionAnswers` matches answers to questions.

Two other pieces of prior art matter:

- Request types are a hardcoded list of 12 in
  `app/counsel/intake/create-intake-form.tsx`, each tagged `mode: 'client' |
  'inhouse'`. That mode is not cosmetic: it decides whether a request is an
  outside-client matter or an internal one.
- Answers are stored in `intake_answers.questionAnswers` as
  `{id, label, value}`, with the label snapshotted alongside the answer. The
  code comments that this exists so renaming a question later cannot mislabel
  historical requests. Someone has already been bitten by this.

## Decisions

Four decisions were taken with the owner before design. Each is recorded with
its cost, because each closes off a cheaper option.

**1. One definition drives both surfaces.** A form built here renders on
Advottic's own employee Hub (`/portal/new`) and is served to partner apps
through the existing `/api/partner/v1/config`. Legal edits once.

*Cost:* the form schema becomes a public contract with a shipped third-party
app. New question types must degrade rather than break Zinpro's client.

**2. Published versions.** Editing produces a draft; publishing writes an
immutable version. Each submitted request binds to the version it was filled
on, so reopening an old request shows the questions that were actually asked,
in the order asked, in the wording used.

*Cost:* a versions table and a publish step, rather than live edits.

**3. Seeded default request types, firm editable.** The current 12 ship as
defaults. A firm can rename them, hide unused ones, and add their own. Types
carry stable ids so renaming does not orphan historical requests.

*Cost:* a types table and a backfill, rather than a hardcoded array.

**4. Simple conditional rules.** One rule per question: show it only when an
earlier question equals, does not equal, or has any answer.

*Cost:* the version format and the partner projection both have to carry
rules. Chosen over a flat v1 because retrofitting rules later would mean a new
version format plus a partner API change, and over a full logic engine because
that is where form builders become unmaintainable.

## Data model

Three new tables, one new column.

```
firm_request_types
  id uuid primary key
  firm_id uuid not null references firms(id) on delete cascade
  key text not null            -- stable, written once: 'nda_review'
  label text not null          -- freely renamed by legal
  mode text not null           -- 'client' | 'inhouse'
  sort_order int not null default 0
  hidden bool not null default false
  created_at timestamptz not null default now()
  unique (firm_id, key)

firm_intake_forms
  id uuid primary key
  firm_id uuid not null references firms(id) on delete cascade
  request_type_id uuid not null references firm_request_types(id) on delete cascade
  draft_payload jsonb                    -- builder scratch space, may be invalid
  published_version_id uuid              -- null until first publish
  updated_at timestamptz not null default now()
  updated_by uuid
  unique (firm_id, request_type_id)

firm_intake_form_versions
  id uuid primary key
  form_id uuid not null references firm_intake_forms(id) on delete cascade
  version int not null                   -- 1, 2, 3 within a form
  payload jsonb not null                 -- immutable, validated before insert
  published_at timestamptz not null default now()
  published_by uuid
  unique (form_id, version)
```

On `firm_matter_intakes`, add `form_version_id uuid` (nullable, references
`firm_intake_form_versions`). Nullable because every existing intake predates
this feature.

`published_version_id` references `firm_intake_form_versions(id)` with
`on delete set null`. Deleting a form cascades to its versions; a version is
never deleted on its own. The two references between these tables point in
opposite directions, so neither may cascade into the other.

### Why key and label are separate

The request type is stored on an intake today as a plain string such as
`'NDA review'`. Renaming it silently detaches every historical intake from its
type. `key` is written once and never changes; `label` is what legal edits.

### Why the draft lives on the form, not in the versions table

A draft is not a version. Keeping it as a column on `firm_intake_forms` means
an unfinished edit can never be mistaken for something publishable, versions
stay strictly immutable, and discarding a draft is one `UPDATE ... SET
draft_payload = NULL`.

## Payload schema

One object per version, defined once in `lib/form-schema.ts` and imported by
the builder, both renderers, the validator and the partner projection, so they
cannot drift.

```ts
type FormPayload = {
  schemaVersion: 1;
  rows: Row[];
};

type Row = {
  id: string;
  fields: Question[];   // 1 to 3
};

type Question = {
  id: string;
  key: string;          // answers are stored against this; immutable once published
  type: QuestionType;
  label: string;
  help?: string;
  required: boolean;
  config: QuestionConfig;   // shape depends on type
  showWhen?: Rule;
};

type Rule = {
  questionId: string;                     // must appear earlier in the form
  op: 'eq' | 'neq' | 'answered';
  value?: string;                         // required for eq and neq
};
```

`QuestionType` is one of: `short_text`, `long_text`, `email`, `phone`,
`number`, `currency`, `date`, `time`, `datetime`, `yesno`, `select`,
`multiselect`.

`QuestionConfig` per type:

| Type | Config |
|---|---|
| `short_text` | `{ maxChars?: number }` |
| `long_text` | `{ maxWords?: number, maxChars?: number }` |
| `email`, `phone` | `{}` |
| `number` | `{ min?: number, max?: number, step?: number }` |
| `currency` | `{ currency: string, min?: number, max?: number }` |
| `date`, `time`, `datetime` | `{ min?: string, max?: string }` |
| `yesno` | `{}` |
| `select`, `multiselect` | `{ options: string[] }` |

Rows carry the layout, so "up to three per row" is structural rather than a
styling hint. A row of one field is a row with one entry.

### Validator invariants

Enforced in `lib/form-schema.ts` before a version can be published. Each is a
real failure mode, not a style preference.

1. **A `showWhen` may only reference a question that appears earlier.** Forward
   references make cycles possible and cannot be evaluated in a single pass.
2. **Question `key`s are unique within a form, and immutable once published.**
   They are what answers are stored against.
3. **`options` is non-empty** for `select` and `multiselect`.
4. **A row holds one to three fields.**
5. `value` is present when `op` is `eq` or `neq`.
6. Labels are non-empty and length-capped.

## Builder interaction

Route: `/counsel/settings/forms`. It sits in settings rather than under Matters
because publishing changes what every employee sees. It is configuration, not
case work.

The index lists request types with each form's state: no form yet, draft, or
published v3.

**The canvas is the form.** Legal edits something that looks like what an
employee fills, not a properties panel beside a preview. Rows stack top to
bottom; any row with fewer than three fields shows a dashed empty slot.

**Adding a question is one click into that empty slot.** The slot opens the
type picker in place, occupying the space the field is about to occupy, so the
choice is visibly about that position. Types are grouped as text (short, long,
email, phone) and structured (number, currency, date, time, date and time,
yes/no, single select, multi select). Choosing one materialises the field with
its label input focused.

**Editing happens on the field.** Clicking a field expands it in place to show
label, help text, required, and the settings its type needs. One field is
expanded at a time.

**Select options** are an add, reorder, remove list plus a paste box that
splits on newlines, because a 30-item department list gets pasted from a
spreadsheet, not typed.

**Rules read as a sentence:** *Show this only when* `[earlier question]`
`[is / is not / has any answer]` `[value]`. The question dropdown lists only
questions above this one, which teaches invariant 1 rather than enforcing it
with an error. Moving a field above its dependency flags the field and blocks
publish, naming both questions.

**Layout changes by drag, with keyboard equivalents** on every field (move up,
down, left, right). A builder that only works with a mouse fails the
accessibility bar applied elsewhere in this codebase.

**Draft and publish.** Edits autosave to `draft_payload`; there is no save
button to forget. The header shows the draft's last-saved time and the
published version. Preview renders the draft through the real employee
renderer, not a mock. Publish validates and, on failure, lists each problem as
a link that scrolls to and focuses the offending field. Discard draft reverts
to the published version.

**Two things the builder states plainly:**

- **Publishing does not change requests already submitted.** Shown on the
  publish confirmation, because the natural fear is that editing rewrites
  history, and version binding means it does not.
- **A warning when a form uses types older partner apps cannot render**, with
  how each degrades. Legal should learn this from the builder, not from a
  confused employee.

**Empty state.** A firm with no form for a type is offered the current
hardcoded questions as a starting point to accept and edit, not a blank canvas.

## Rendering and validation

`components/forms/FormRenderer.tsx` takes a payload and answers, renders rows
and fields, and evaluates rules. Both `/portal/new` and the counsel-side create
form mount it. There is no second implementation.

`lib/form-validate.ts` takes a payload plus answers and returns per-question
errors. The renderer imports it for live feedback; the submit action imports it
for enforcement. **The server is the authority.** A rule evaluated only in the
browser is not enforced.

**A hidden question is not required.** If *Counterparty name* shows only when
*Is there a counterparty?* is Yes, answering No must submit cleanly. Validation
evaluates visibility first, then requiredness, skipping anything hidden, on the
server as well as the client. Otherwise an employee is blocked by a question
they were never shown. This is the highest-value test in the feature.

Answers key on question `key`, never on row or index, so reordering a form
cannot re-associate an answer with the wrong question.

## Partner API projection

The live contract is `GET /api/partner/v1/config` returning
`{ ackMessage, questions: [{id, label, type, options?, required?}] }` where
type is `text | select | yesno`. Zinpro's shipped app parses exactly that.
**The response shape does not change.**

`lib/form-to-partner.ts` projects a published payload down to it:

- **Rows flatten** into one ordered list. Layout is presentation; the partner
  app has its own.
- **Conditional questions are emitted unconditionally and never required**,
  whatever their own setting. They must appear, or a partner-app employee can
  never supply them. They cannot be required, or the employee is blocked by a
  question that may not apply. Their real requiredness is enforced on arrival
  against the true rules.
- **Types map down**: `short_text`, `long_text`, `email`, `phone`, `number`,
  `currency`, `date`, `time`, `datetime` become `text`; `yesno` stays;
  `select` stays; `multiselect` becomes `select` carrying its options, since
  the app cannot express multi-choice.
- **Constraints do not survive** the projection. `maxWords`, `min`, `max` and
  `currency` are enforced server-side on arrival by `resolveQuestionAnswers`,
  which returns an error naming the question.

Partner tickets already carry a `requestType`, so the projection serves that
type's published form. Where no form is published, it falls back to the firm's
existing `partnerIntegration.questions`. **A firm that never opens the builder
sees no change at all**, which is the migration story and means this ships
without coordinating a Zinpro release.

**Version attribution.** The config response gains an optional
`formVersionId`, which partner apps may echo back on create. If echoed, the
intake binds to that exact version. If not, which includes Zinpro's app today,
it binds to whatever is published on arrival and records that the binding was
inferred. Additive, so it cannot break an existing client.

## Permissions

RLS mirrors the role sets standardised in `lib/firm-authz.ts`:

- Read `firm_request_types`, `firm_intake_forms`, `firm_intake_form_versions`:
  any firm member.
- Insert, update, publish: `owner`, `admin`, `attorney`.
- `paralegal` and `staff` read but cannot publish.

Publishing changes what every employee sees, so it is treated as a settings
change rather than case work.

## Migration and compatibility

1. Create the three tables and the `form_version_id` column.
2. Backfill `firm_request_types` from **two** sources, because two different
   vocabularies are already in the data.

   **The hardcoded 12.** `key` is a slug of the value string (`'NDA review'`
   becomes `'nda_review'`); `label` is the value string verbatim. Intakes filed
   through Advottic's own form store that string in `matter_type` and
   `intake_answers.request_type`, so they match a type by comparing the stored
   string to `label`, which is why the seeded label must start verbatim.

   **The partner's own slugs.** Every ticket filed through
   `/api/partner/v1/*` carries a lowercase slug of the partner's choosing in
   `matter_type` and leaves `request_type` null. Zinpro is already using `nda`,
   `hr`, `contract-review` and `incident`, none of which appear in the
   hardcoded 12. For these, seed one type per distinct slug observed for that
   firm, with `key` set to the slug **verbatim** and `label` humanised.

   So `key` is not merely an internal stable id. For partner-facing types it is
   the join key with the partner's vocabulary and must equal their slug exactly,
   or projected forms and arriving tickets will not meet.

   **Known wart:** Zinpro will end up with both `nda` (from the partner) and
   `nda_review` (from the defaults). They are not merged automatically, because
   merging would guess at intent and the two may genuinely differ. Legal can
   hide the unused one in the builder. Auto-merging near-duplicate labels is
   explicitly rejected.

   Renaming a seeded type after backfill detaches it from its pre-existing
   intakes. Accepted, because the alternative is freezing labels forever, and
   the counsel intake page reads the stored string directly rather than
   resolving the type.
3. No form rows are created. Every firm starts with zero published forms and
   therefore identical behaviour to today.
4. `intake_answers.questionAnswers` keeps its existing `{id, label, value}`
   shape. The label snapshot stays even though version binding makes full
   reconstruction possible, so the counsel intake page keeps rendering for
   intakes that predate this feature. No existing data is migrated.

## Testing

- **Validator:** each invariant, including forward references and duplicate
  keys.
- **Rule evaluation:** the hidden-and-required case, on the server path
  specifically. Exhaustive over the three operators.
- **Answer keying:** reordering a form does not re-associate answers.
- **Partner projection:** every question type maps to a type Zinpro's app
  understands; conditional questions emerge unconditional and optional;
  constraint enforcement on arrival returns a named error.
- **Publish path:** a draft that fails validation cannot become a version.
- **Version immutability:** publishing v3 leaves v2's payload byte-identical.

## Out of scope for v1

- Multiple conditions, AND/OR groups, skip-to-section, required-when rules.
- File upload as a question type. The intake already carries attachments.
- Per-question analytics.
- Changing the partner API response shape, and the corresponding update to
  `docs/ZINPRO_INTEGRATION.md`, until Zinpro confirms they want
  `formVersionId`. The server side works either way; publishing a contract
  change nobody has agreed to is how integrations rot.
- Light mode and the Techottic visual treatment. Separate project.
- QR mobile signing. Separate project.

## Risks

**Several firm features have shipped and never been exercised once.**
`firm_intake_participants` has zero rows and `firm_invoices` is empty. Trust
accounting and invoicing were both found broken in ways that would have
surfaced on first real use, and nobody had reached them. This is what the v1
scope above exists to prevent: one request type proved through the entire loop,
including a real ticket arriving from Zinpro's app, rather than a broad surface
that compiles and has never been used.

**The partner contract is live.** Every change to the projection is a change
felt by a shipped third-party app. The projection is the piece to test hardest.

**Publishing is destructive to expectations, not data.** Legal can publish a
form that removes a question employees were relying on. Version binding
protects history, but there is no approval step. If that matters, it is a
follow-up, not a v1 gap.
