# Two modes for a firm matter

The owner, looking at `/counsel/cases/<id>`:

> Please only use this screen if there is a court case, or the firm has selected
> build a case. This is not how normal employee requests should appear. This is
> only the court case view.

Every matter currently gets the full litigation workbench: a case menu of four
court surfaces, a metric strip, an evidence analytics dashboard nested in a
collapsible tile, and the Case Theory Console. A policy question from an
employee gets the same page a wrongful-termination suit gets. That is wrong on
its own terms and it is worst for the in-house teams the `corporate` firm type
shipped for today, who do not litigate most of what crosses their desk.

## The two modes

**Simple.** The default. A plain matter page in the DETAIL pattern of
`docs/PARITY-PAGE-RULES.md`: breadcrumb with the firm's mono matter reference,
title, meta chips, an action bar in its own bordered card, then two columns.
Party facts, naming conventions, the edit form, the matter room, the people on
the matter, time and billing if the firm has that surface, project binders; and
an aside of deadlines, documents and links.

**Litigation.** Simple, plus the case file: the case menu (Case Timeline,
Evidence Center, Case approach, Export), the evidence analytics panel, the Case
Theory Console, and the time and billing metric strip.

Litigation mode is deliberately a workbench. It is not being made to conform to
DETAIL, because a firm that opens a case file has asked for a workbench. What
changes is that it is no longer what a routine request gets.

## The flag

`cases` has no `metadata` jsonb column. Every `alter table public.cases` in the
repo was checked: `posture`, `subject_profile`, `hearing_at`,
`hearing_location`, `hearing_notes`, `assigned_to`, `sandbox`,
`text_normalizations`, `matter_number`. There is no general-purpose bag on this
table, so the `firms.metadata` trick that let the firm-type work ship without a
migration is not available here.

`cases.subject_profile` is jsonb and already carries one non-party key
(`featuredImageId`), so it could physically hold this. It is the party dossier,
edited field by field by the 60-field matter form, and putting the shape of the
whole page inside the record of who the other side is would be a trap for the
next person. Rejected.

So: a migration, adding one nullable column.

```sql
alter table public.cases add column if not exists litigation_mode boolean;
```

Nullable with no default, three-valued on purpose:

- `true` — a person opened the case file.
- `false` — a person closed it. This beats every inferred signal.
- `null` — nobody has said. Fall through to the hearing trigger.

The migration is written but **NOT APPLIED**. Applying it and regenerating
`supabase/schema-fingerprint.sha256` are the owner's steps. Until then the
column does not exist, and PostgREST answers a select naming it with error code
`42703`, so `lib/case-file.ts` retries the read without the column and every
matter resolves on the hearing trigger alone. The toggle action detects the same
code and returns a calm sentence rather than a crash.

## The two triggers

**1. There is a court case.** `cases.hearing_at` / `cases.hearing_location`,
already on the table, already indexed, and only ever set by a person typing a
court date and courtroom into the matter form. A hearing is a court case. It is
deliberate, not inferred from a shape.

`cases.case_type` was considered and rejected. It is written from
`intake.matter_type` at `lib/firm-actions.ts:1885` and defaults to `'other'`.
`matter_type` is free text with no enum and no CHECK, so its values are whatever
a firm typed into an intake form. Gating a page on it would mean a firm that
writes "Litigation" gets a workbench and one that writes "litigation matter"
does not. It is not a litigation signal today and the gate is not built on it.

**2. The firm selected build a case.** `litigation_mode = true`, set from a
control on the matter page itself.

Resolution order, in the pure resolver `lib/case-mode.ts`:

| # | Condition | Mode | Source |
|---|---|---|---|
| 1 | `litigation_mode === true` | litigation | `explicit` |
| 2 | `litigation_mode === false` | simple | `explicit` |
| 3 | `hearing_at` or `hearing_location` set | litigation | `hearing` |
| 4 | otherwise | simple | `default` |

A person's answer beats the signal in both directions, the same precedence
`lib/firm-workspace.ts` established for surface overrides an hour ago.

## Backfill

The migration also backfills, once, so applying it does not take a workbench
away from a matter someone is in the middle of:

```sql
update public.cases c set litigation_mode = true
where c.litigation_mode is null
  and (c.hearing_at is not null
       or exists (select 1 from public.case_approaches a where a.case_id = c.id)
       or exists (select 1 from public.case_timeline_events e where e.case_id = c.id));
```

That turns "there is already case work here" into stored, explicit state that a
person can then switch off. It is deliberately a one-time backfill and not a
runtime rule: as a runtime rule it could not be switched off, because the work
it looks at is exactly the work switching the mode off is supposed to hide.

## Who switches it

`FIRM_MANAGE_ROLES` (owner, admin, attorney). Deciding a matter is a court case
is a lawyer's call. `paralegal` and `staff` see the state and no control.

Reversible by the same three roles, from the same panel, in one click. That
reversibility is what makes it safe to refuse reads as well as writes below.

## What moves behind the gate

| Surface | Where | Server-side refusal |
|---|---|---|
| Case menu (Timeline, Evidence, Approach, Export) | `page.tsx` | the four targets below |
| Case Timeline page | `cases/[id]/timeline/page.tsx` | redirect to the matter |
| Evidence Center page | `cases/[id]/evidence/page.tsx` | redirect to the matter |
| Export preview | `cases/[id]/preview/page.tsx` | redirect to the matter |
| Court packet export | `cases/[id]/export/route.ts` | 403 |
| Approach export | `cases/[id]/approach/[approachId]/export/route.ts` | 403 |
| Secure share | `cases/[id]/share/route.ts` | 403 |
| Evidence search index | `cases/[id]/search-index/route.ts` | 403 |
| Evidence file download | `cases/[id]/evidence/download/route.ts` | 403 |
| Case Theory Console | `page.tsx` | `lib/firm-approach-actions.ts` gate |
| Evidence analytics panel | `page.tsx` | `lib/case-evidence-actions.ts` gate |
| Time and billing metric strip | `page.tsx` | none needed, it is a read of rows shown elsewhere |
| Timeline builder writes | timeline page | `lib/firm-timeline-actions.ts` gate |
| Evidence re-analysis | evidence page | `lib/case-evidence-bulk.ts` gate |
| Legal review | no caller today | `lib/firm-legal-review-actions.ts` gate |

Each of those five action modules already funnels every export through one
private `assertFirmCase`. The mode check is added by renaming that function to
`assertFirmCaseAccess` and giving each module a two-line `assertFirmCase`
wrapper that calls it and then `caseFileRefusal(caseId)`. One insertion point
per module; every existing call site is untouched; and the mode is consulted
only *after* access is proven, so the refusal cannot be used to learn whether a
guessed case id is real. That ordering is the property four of those five gates
already comment on at length.

The metric strip is the one gated surface with no server-side refusal, and it
needs none: it is a sum over `firm_time_entries` and the trust ledger, rows the
Time and billing sections on the same page already list. Hiding a dashboard
strip is not a claim about data. In simple mode the same figures appear as one
quiet line inside the "Time on this matter" section, which is where the DETAIL
pattern wants them.

## Refusing reads, not just writes

`lib/firm-surface-guard.ts` deliberately guards writes only, and says why:
refusing reads of Time and Billing would make a firm's invoices unreachable,
which is deletion with extra steps.

This gate refuses reads too, and the difference is the distance back. Hiding a
workspace surface is a firm-wide setting several pages away from the invoice you
cannot see. Here the switch is a card on the matter page you are already on,
scoped to that one matter, and one click from any of the three roles that can
reach it. A closed case file is a shut drawer, not a shredder.

## What happens to the work

Nothing is deleted, and no row is written by switching modes except the
`litigation_mode` column itself.

- **Evidence** — `case_timeline_events` rows and their storage objects are
  untouched. The Evidence Center redirects, downloads 403, re-analysis refuses.
  Reopening the case file brings back every item, its folder, its exhibit
  number and its analysis.
- **Timeline** — `case_timeline_events.on_timeline`, `case_people` and
  `case_timeline_narratives` are untouched. The builder redirects. Reopening
  restores the timeline as it was, narrative included.
- **Approaches** — `case_approaches` rows, their prompts and their generated
  arguments are untouched. The console stops rendering and its actions refuse.
  Reopening shows every saved approach. No approach is regenerated by
  reopening, and no token is spent by either switch.
- **Exports and shares already sent** — an encrypted share packet already
  emailed stays readable at its `/share/[token]` link. That link is served from
  a storage object created at share time, not rebuilt from the matter, and
  revoking a document already in a recipient's hands is a different feature.
- **Deadlines, documents, invoices, trust, chat, people** — not gated at all.
  They belong to any matter.

## Co-counsel guests

A `counsel_guest` reaching a simple matter gets a calm panel saying the case
file is not open, instead of the guest workspace, and every action they could
have run refuses through the same five gates. A guest exists because the firm
invited outside counsel onto that matter, so in practice such a matter will be
in litigation mode; this is the fail-closed branch, not the expected one.

## Testing

- `tests/case-mode.test.ts` — the pure resolver: all four rows of the table,
  and explicit `false` beating a set hearing date.
- `tests/case-file-gate.test.ts` — source-level: every one of the five action
  modules calls `caseFileRefusal` in its gate and not merely imports it, the
  gate is called after the access check rather than before, and each of the five
  routes and three pages reaches the guard. Assert the guard is APPLIED, not
  that its name appears.
- Every guard proven by mutation: revert the guard line, watch the test go red,
  restore, confirm the file is byte-identical.

## Not doing

- Making litigation mode conform to DETAIL. Out of scope and against the point.
- Touching the 60-field inline edit form, the realtime chat or the activity
  feed. All three are on the audit's list and none is a litigation surface.
- A per-firm default. The default is simple for everyone. A firm that litigates
  everything opens the case file per matter, which is one click, and the hearing
  trigger already covers the matters where a court date exists.
