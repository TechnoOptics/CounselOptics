# HQ organization trial lifecycle

Design, 2026-08-01. Approved by the owner before writing.

## The problem

Advottic HQ has no way to run a trial. There is no trial state, no expiry, no
seat limit, and no way to cut off an organization that has stopped paying or
never started. Everything is on or off by virtue of an organization existing.

The owner's words:

> For Advottic HQ, please allow me to extend trial periods for organization and
> automatically disable the account when the trial period has ended. Allow hq
> admin to view the organizations that are on the trials, assign accounts that
> can use the platform, reset the timer, please also have a policy or link that
> allows the users to download their data which will be deleted after 30 days.

## What exists today, verified rather than assumed

`public.firms` is: `id`, `slug`, `name`, `logo_url`, `accent_color`,
`jurisdictions`, `practice_areas`, `created_by`, `created_at`, `updated_at`,
`firm_type`, `metadata` (jsonb), `subdomain_enabled`, `token_pool_balance`,
`token_pool_period_end`, `letterhead_url`.

There is no trial column, no status column and no disable flag. None of this
exists.

`app/api/account/export/route.ts` exists but is per individual user, covering
their own profile, subscription and cases. There is no organization-level
export.

The HQ surface is `app/admin/`, wearing `.hq-shell`, and already has a `firms`
section. HQ authorization is `profile.isAdmin`, a different axis from
`lib/firm-authz.ts`, which governs firm surfaces.

There is precedent for scheduled deletion: community cases carry
`purge_scheduled_at` with a retention purge job, and close and reopen schedule
and cancel it.

## The decision that shaped everything else

The owner's original request included deleting an organization's data 30 days
after the trial ends. That was raised as dangerous in this product specifically,
and the owner chose not to do it.

The objection, recorded because the reasoning should outlive the decision:
Advottic holds active legal matters, evidence, signed documents and PHI under a
live compliance program.

- **Litigation hold.** Deleting a matter under hold is spoliation of evidence.
  That is sanctions against the customer and a claim against Advottic.
- **Retention law.** HIPAA requires six years for certain records. State bar
  rules commonly require client file retention for five to seven years after a
  matter closes. A 30 day timer contradicts both.
- **Third parties.** The data belongs partly to the firm's clients and to people
  who signed documents. None of them agreed to the trial terms, and deleting a
  signed agreement removes their evidence too.

**Resolved: nothing is deleted automatically.** The export is available, the
organization is told their access is ending, and deletion happens only when the
organization asks for it. Disabling access is reversible and carries none of the
above. Deleting data is irreversible.

**This makes the copy a correctness requirement, not a style preference.** The
page must not say the data will be deleted, because it will not be. It says
access ends on a date, and to download before then. That is true, and it still
creates the urgency the owner wanted.

## What "disabled" means

The owner first chose sign-in blocked entirely, then chose export-only sign-in
as the way an organization still retrieves its data. Those resolve to one thing:

**Sign-in succeeds. The session can reach the export page and nothing else.**

The product is genuinely closed. There is one enforcement point rather than a
separate link, a separate token and a separate expiry, and the person who needs
their data uses the credentials they already have.

## State, and the one function that decides

Three columns on `firms`:

```sql
alter table public.firms
  add column if not exists trial_ends_at timestamptz,
  add column if not exists seat_limit int,
  add column if not exists suspended_at timestamptz;
```

`trial_ends_at` null means the organization is not on a trial. `seat_limit` null
means no limit. `suspended_at` is the manual override for cutting an
organization off regardless of dates.

Columns on `firms` rather than `metadata` jsonb, because this is read on every
request to decide whether the caller may proceed, and a hot enforcement path
should not be digging through jsonb. Columns rather than a separate current-state
table, because that would put a join on the same hot path.

One function is the only place the rule exists:

```ts
export type FirmAccessState = 'active' | 'export_only';

export function firmAccessState(
  firm: { trialEndsAt: Date | string | null; suspendedAt: Date | string | null },
  now: Date,
): FirmAccessState;
```

Export-only if suspended, or if `trial_ends_at` has passed. Active otherwise.

**No scheduled job is needed anywhere.** "Automatically disable when the trial
ends" is a comparison evaluated on every request, not a nightly task. Nothing
can fail silently at 3am, there is no window in which a trial has expired but the
job has not noticed, and extending a trial takes effect on the next page load
rather than the next tick.

The timestamps are declared `Date | string` and normalised inside the function,
because this repo's Supabase client returns `timestamptz` as ISO strings and a
`Date`-typed field holding a string fails open on comparison. `lib/api-tokens.ts`
types `expires_at` as `string | null` and three call sites wrap with `new Date`.
Coercion alone is insufficient: `new Date('garbage')` is an Invalid Date whose
comparisons are also all false, so the function validates and throws on anything
unparseable.

## Enforcement, in two layers

**Layer one, the shell.** A firm in `export_only` is redirected to the export
page from any counsel or portal route.

**Layer two, the write paths.** Every `'use server'` export is a public HTTP
endpoint, so a shell redirect is not a gate. An organization in `export_only`
must be refused by the actions themselves, not merely steered away in the UI.

Both layers are required. This codebase has produced this exact defect twice:
a gate present in the UI while the underlying action remained callable, once on
the intake form path and once on document release. The second layer is the gate;
the first is a courtesy.

## Seats

`seat_limit` is checked when an organization adds a member. Over-limit
organizations are **grandfathered, never ejected**: lowering a limit does not
remove anyone already in place. Ejecting people from a running organization to
enforce a number that was just changed is hostile and would strand work in
progress.

## The export

Organization-scoped, following the shape of the existing per-user export. It is
available at all times, not only at trial end, because an export that appears
only when you are being cut off reads as a hostage note.

**Only an owner or admin of the organization may run it.** An organization
export contains every matter, every document and every client name the firm
holds. A paralegal or a staff member downloading the whole firm on their way out
of the door is a data loss incident, not an offboarding feature. Roles come from
`lib/firm-authz.ts` as everywhere else.

So a member without that role, in an `export_only` organization, lands on a page
saying their organization's access has ended and naming who to speak to. They
are not shown an export button that would refuse them, and they are not left
guessing why the product stopped working.

## HQ, and the audit trail

A trials view listing organization, trial end date, days remaining, seats used
against limit, and current state.

Actions: extend, reset, change seats, suspend, restore. All are restricted to
`profile.isAdmin`. Precisely:

- **Extend** moves `trial_ends_at` forward by a number of days the admin enters.
  It is relative to the existing end date, not to today, so extending a trial
  that lapsed last week does not silently grant a longer run than intended.
- **Reset** sets `trial_ends_at` to today plus a number of days the admin
  enters. This is the one that starts the clock again from now, and it is a
  separate action from extend precisely because the two are easy to confuse and
  the difference is commercially meaningful.
- **Suspend** sets `suspended_at`. **Restore** clears it.
- Extend and reset do NOT clear `suspended_at`. A suspended organization stays
  closed until it is explicitly restored, so a date change cannot accidentally
  reopen an organization that was cut off deliberately. The HQ view says so
  where both are true, rather than showing a future end date beside a closed
  organization with no explanation.

Every one writes a row:

```sql
create table if not exists public.firm_trial_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  action text not null check (action in
    ('granted', 'extended', 'reset', 'suspended', 'restored', 'seats_changed')),
  actor_user_id uuid,
  previous_value text,
  new_value text,
  note text,
  created_at timestamptz not null default now()
);
```

RLS enabled with no policy. Both the reads and the writes are server-side under
`profile.isAdmin`, and a table closed by default is the correct posture for a
commercial control surface.

These are commercial levers. "Who gave that firm another month, and when" is a
question that gets asked, and the answer should not depend on anybody's memory.

## Testing

The decision logic is pure and goes in a module with no I/O: `firmAccessState`
across active, expired, suspended, suspended-and-expired, and not-on-a-trial;
timestamp normalisation including ISO strings and unparseable input; and the seat
check including the grandfathering rule. That is fully node-testable, which
matters because this repo's vitest runs `environment: 'node'` with no jsdom and
no dependency may be added for one.

The enforcement layer needs a test that an action refuses an `export_only`
organization, because that is the layer the UI cannot be trusted to provide.

## Compliance

The retention posture changes: organizations that lapse retain their data
indefinitely until they ask for deletion. That is a deliberate choice and it
belongs in `docs/compliance/` alongside the existing risk register, stated as
what it is. No certified claim is made anywhere in the product.

## Out of scope

- Automatic deletion of any kind, and the litigation hold flag that would be
  required to make it safe.
- Billing, payment collection, and any Stripe interaction. This is trial state
  only.
- Naming which individual users inside an organization may sign in. The owner
  chose seat counts; the organization's own admin decides who fills them.
- Per-organization feature toggles. `firm_settings` already carries surface
  toggles and is a separate concern.
- Self-serve trial signup. HQ grants trials.
