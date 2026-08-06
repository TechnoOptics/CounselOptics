# HQ Trial Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HQ grant, extend, reset and suspend organization trials, close the product automatically when a trial lapses, cap seats, and leave the organization able to download its own data.

**Architecture:** Three columns on `firms` plus an audit table. One pure function decides access from those columns and the clock, so expiry is a comparison evaluated per request rather than a flag flipped by a job. Enforcement is two layers, a shell redirect and a refusal inside the write paths, because a `'use server'` export is a public HTTP endpoint and a redirect is not a gate.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres, service-role client), Tailwind v3, vitest in `environment: 'node'`.

**Source spec:** `docs/superpowers/specs/2026-08-01-hq-trial-lifecycle-design.md` (commit `0d45227`).

## Global Constraints

- **No em dashes** anywhere: code, comments, UI copy, docs. Use commas, periods, parentheses, colons or hyphens.
- **No emoji** anywhere.
- **No new dependencies.**
- **Copy is a correctness requirement here, not a style preference.** Nothing may state or imply that the organization's data will be deleted, because under this design it will not be. It says access ends on a date, and to download before then.
- **Every `'use server'` export is a public HTTP endpoint.** Privileged helpers belong in `import 'server-only'` modules.
- **HQ authorization is `isCurrentUserAdmin`. Firm authorization is `lib/firm-authz.ts`.** Do not write a third membership check.
- **Timestamps are declared `Date | string` and VALIDATED, not merely coerced.** See "The timestamp rule" below. This is not a style note; it is a fail-open defect that has already cost a fix round in this repo.
- **vitest runs `environment: 'node'`** with no jsdom and no testing-library, and none may be added. Pure logic must be extracted into modules with no I/O so it can be tested.
- Run `npx tsc --noEmit` and `npm run build` before every commit.
- The final task runs `npm run test:audit-guards`. It currently FAILS on `main` with 11 pre-existing unreviewed `<T>` wraps. This branch must not add a twelfth.

## The timestamp rule, stated once and binding on every task

This repo's Supabase client returns `timestamptz` as ISO **strings**. `lib/api-tokens.ts:99` types `expires_at` as `string | null`, and three call sites wrap with `new Date(...)`.

A field typed `Date` that actually holds a string **fails open** on comparison: `now >= '2026-08-01T12:15:00Z'` coerces both sides to numbers, the string becomes `NaN`, and the comparison is `false`. An expired trial would read as active forever.

Coercion alone does not fix it. `new Date('garbage')` is an Invalid Date whose comparisons are **also** all false. So every timestamp entering a decision function is normalised **and validated**, throwing on anything unparseable.

## The two-layer rule, stated once and binding on Task 4

A shell redirect is not a gate. Every `'use server'` export is reachable by direct HTTP request regardless of what the UI shows. This codebase has produced exactly that defect twice: once where intake validation was gated on a caller-supplied field, and once where document release was gated in the UI while the action stayed callable. Both were rated Important and both needed a fix round. Task 4 therefore has two halves and neither is optional.

## What exists today, verified rather than assumed

`public.firms` is: `id`, `slug`, `name`, `logo_url`, `accent_color`, `jurisdictions`, `practice_areas`, `created_by`, `created_at`, `updated_at`, `firm_type`, `metadata` (jsonb), `subdomain_enabled`, `token_pool_balance`, `token_pool_period_end`, `letterhead_url`. There is **no** trial column, **no** status column and **no** disable flag.

- HQ gate: `app/admin/layout.tsx:90-91` is `const admin = await isCurrentUserAdmin(); if (!admin) redirect('/cases');`
- `lib/hq-storage.ts:51` `adminListFirms(): Promise<HqFirmRow[]>`, uses `createAdminSupabase()` and returns `[]` when it is null.
- `app/admin/firms/page.tsx` composes `SubdomainToggle`, `BrandingEditor` and `ImpersonateOwnerButton`. That is the pattern for new trial controls.
- `app/counsel/layout.tsx` resolves `getActiveFirmContext` and already redirects at `:97`, `:125`, `:129`, `:188`, `:195`.
- `app/portal/layout.tsx:177` wears `counsel-shell` and needs the same guard.
- `app/api/account/export/route.ts` is the per-user export to follow: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, uses `logSecurityEvent` and `requestMeta` from `lib/security-audit`.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/firm-access.ts` | Pure. Timestamp normalisation, `firmAccessState`, `seatCheck`. No I/O. |
| `tests/firm-access.test.ts` | Real assertions over every rule above, including the mutations named per task. |
| `supabase/migrations/20260801_firm_trials.sql` | Three columns, the audit table, its index and RLS. Written, NOT applied. |
| `lib/firm-trials.ts` | `import 'server-only'`. The only module that reads or writes trial state and the audit table. |
| `lib/firm-trial-actions.ts` | `'use server'`. The five HQ actions. Each resolves `isCurrentUserAdmin` itself. |
| `app/counsel/access-ended/page.tsx` | Where an export-only organization lands. Export for owner and admin, explanation for everyone else. |
| `app/api/firm/export/route.ts` | Organization-scoped export. Owner and admin only. |
| `app/admin/firms/trial-controls.tsx` | HQ client component: extend, reset, seats, suspend, restore. |

---

### Task 1: The pure access-state module

**Files:**
- Create: `lib/firm-access.ts`
- Test: `tests/firm-access.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toInstant(value: FirmTimestamp): Date`, `firmAccessState(firm: FirmAccessInput, now: FirmTimestamp): FirmAccessState`, `seatCheck(input: SeatCheckInput): SeatCheckResult`, and the types `FirmTimestamp`, `FirmAccessInput`, `FirmAccessState`, `SeatCheckInput`, `SeatCheckResult`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  toInstant,
  firmAccessState,
  seatCheck,
  type FirmAccessInput,
} from '../lib/firm-access';

const T0 = new Date('2026-08-01T12:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function firm(over: Partial<FirmAccessInput> = {}): FirmAccessInput {
  return { trialEndsAt: null, suspendedAt: null, ...over };
}

describe('toInstant', () => {
  it('accepts a Date unchanged', () => {
    expect(toInstant(T0).getTime()).toBe(T0.getTime());
  });

  it('accepts the ISO string shapes PostgREST actually returns', () => {
    for (const s of [
      '2026-08-01T12:00:00+00:00',
      '2026-08-01T12:00:00.123456+00:00',
      '2026-08-01 12:00:00+00',
    ]) {
      expect(Number.isNaN(toInstant(s).getTime())).toBe(false);
    }
  });

  it('throws rather than failing open on an unparseable value', () => {
    expect(() => toInstant('garbage')).toThrow();
    expect(() => toInstant('')).toThrow();
  });
});

describe('firmAccessState', () => {
  it('is active when the organization is not on a trial', () => {
    expect(firmAccessState(firm(), T0)).toBe('active');
  });

  it('is active while the trial is running', () => {
    expect(firmAccessState(firm({ trialEndsAt: days(5) }), T0)).toBe('active');
  });

  it('is export_only once the trial end has passed', () => {
    expect(firmAccessState(firm({ trialEndsAt: days(-1) }), T0)).toBe('export_only');
  });

  it('is export_only exactly at the trial end', () => {
    expect(firmAccessState(firm({ trialEndsAt: T0 }), T0)).toBe('export_only');
  });

  it('is export_only when suspended, even with a trial still running', () => {
    const f = firm({ trialEndsAt: days(30), suspendedAt: days(-1) });
    expect(firmAccessState(f, T0)).toBe('export_only');
  });

  it('is export_only when suspended and not on a trial at all', () => {
    expect(firmAccessState(firm({ suspendedAt: days(-1) }), T0)).toBe('export_only');
  });

  it('reads an expired trial supplied as an ISO STRING as export_only', () => {
    const f = firm({ trialEndsAt: '2026-07-31T12:00:00+00:00' });
    expect(firmAccessState(f, T0)).toBe('export_only');
  });

  it('reads a running trial supplied as an ISO STRING as active', () => {
    const f = firm({ trialEndsAt: '2026-09-01T12:00:00+00:00' });
    expect(firmAccessState(f, T0)).toBe('active');
  });
});

describe('seatCheck', () => {
  it('allows adding when there is no limit', () => {
    expect(seatCheck({ seatLimit: null, currentMembers: 99 }).ok).toBe(true);
  });

  it('allows adding below the limit', () => {
    expect(seatCheck({ seatLimit: 5, currentMembers: 4 }).ok).toBe(true);
  });

  it('refuses adding at the limit', () => {
    const r = seatCheck({ seatLimit: 5, currentMembers: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });

  it('refuses adding above the limit, and never reports an ejection', () => {
    const r = seatCheck({ seatLimit: 3, currentMembers: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/firm-access.test.ts`
Expected: FAIL, cannot find module `../lib/firm-access`.

- [ ] **Step 3: Implement the module**

```ts
/**
 * Pure rules for whether an organization may use the product.
 *
 * No I/O, so every rule below is unit tested. lib/firm-trials.ts owns the
 * database.
 *
 * Expiry is a COMPARISON, not a flag. There is no scheduled job anywhere in
 * this feature: nothing can fail silently overnight, there is no window in
 * which a trial has lapsed but a job has not noticed, and an extension takes
 * effect on the next page load rather than the next tick.
 */

/**
 * This repo's Supabase client returns timestamptz as ISO STRINGS, so a field
 * typed Date can hold a string at runtime. Declaring the union and normalising
 * on entry is what stops that becoming a fail-open.
 */
export type FirmTimestamp = Date | string;

export type FirmAccessInput = {
  trialEndsAt: FirmTimestamp | null;
  suspendedAt: FirmTimestamp | null;
};

export type FirmAccessState = 'active' | 'export_only';

export type SeatCheckInput = {
  seatLimit: number | null;
  currentMembers: number;
};

export type SeatCheckResult =
  | { ok: true }
  | { ok: false; reason: 'seat_limit_reached' };

/**
 * Normalise AND validate. Coercion alone is not enough: `new Date('garbage')`
 * is an Invalid Date whose comparisons are all false, so a bad value would
 * read as "not yet expired" forever. Throwing is the fail-closed choice.
 */
export function toInstant(value: FirmTimestamp): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error('firm-access received an unparseable timestamp.');
  }
  return instant;
}

export function firmAccessState(
  firm: FirmAccessInput,
  now: FirmTimestamp,
): FirmAccessState {
  const at = toInstant(now);

  // Suspension is the manual override and outranks the dates, so a date
  // change cannot accidentally reopen an organization that was closed
  // deliberately.
  if (firm.suspendedAt != null) return 'export_only';

  // No trial means nothing to expire. A paying organization has no
  // trial_ends_at.
  if (firm.trialEndsAt == null) return 'active';

  return at >= toInstant(firm.trialEndsAt) ? 'export_only' : 'active';
}

/**
 * Checked when an organization ADDS a member. Never used to remove one:
 * lowering a limit does not eject anyone already in place, because ejecting
 * people from a running organization to enforce a number that was just
 * changed strands work in progress.
 */
export function seatCheck(input: SeatCheckInput): SeatCheckResult {
  if (input.seatLimit == null) return { ok: true };
  if (input.currentMembers < input.seatLimit) return { ok: true };
  return { ok: false, reason: 'seat_limit_reached' };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/firm-access.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Prove the tests kill the mutations, not just pass**

A passing suite is not evidence. Break the implementation four ways in turn, confirm at least one test goes red each time, then restore it. Record which test caught each in your report.

1. In `toInstant`, delete the `Number.isNaN` guard so it coerces without validating. Expected red: `throws rather than failing open on an unparseable value`.
2. In `firmAccessState`, change `at >= toInstant(firm.trialEndsAt)` to `at > toInstant(...)`. Expected red: `is export_only exactly at the trial end`.
3. In `firmAccessState`, move the `suspendedAt` check below the `trialEndsAt` null check. Expected red: `is export_only when suspended and not on a trial at all`.
4. In `seatCheck`, change `<` to `<=`. Expected red: `refuses adding at the limit`.

If any mutation leaves the suite green, that rule is unpinned. Add a test that catches it before moving on.

- [ ] **Step 6: Type-check, build, commit**

```bash
npx tsc --noEmit && npm run build
git add lib/firm-access.ts tests/firm-access.test.ts
git commit -m "Add the pure rules for organization trial access

Expiry is a comparison rather than a flag, so no scheduled job exists.
Timestamps are validated as well as coerced, because this repo's
Supabase client returns timestamptz as ISO strings and an Invalid Date
compares false against everything, which would read as never expired.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The migration, written but NOT applied

**Files:**
- Create: `supabase/migrations/20260801_firm_trials.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `firms.trial_ends_at`, `firms.seat_limit`, `firms.suspended_at`, and the table `public.firm_trial_events`. Read by Task 3.

**APPLYING THIS TO PRODUCTION IS THE CONTROLLER'S STEP, NOT YOURS.** Write the file. Do not run it. Do not use any Supabase tool to apply it. State plainly in your report that it is unapplied.

- [ ] **Step 1: Write the migration**

```sql
-- Organization trial lifecycle: expiry, seats, suspension, and an audit trail.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-01. The owner applies this and regenerates
-- supabase/schema-fingerprint.sha256 in the same change, or the CI drift
-- gate fails on the next push.
-- =========================================================================
--
-- Columns on firms rather than metadata jsonb because these are read on
-- EVERY request to decide whether the caller may proceed, and a hot
-- enforcement path should not be digging through jsonb. Columns rather than
-- a separate current-state table because that would put a join on the same
-- path.
--
-- All three are nullable and all three default to null, so applying this is
-- invisible: every existing organization has no trial, no seat limit and no
-- suspension, which firmAccessState reads as 'active'. Behaviour is
-- unchanged until HQ grants a trial.

begin;

alter table public.firms
  add column if not exists trial_ends_at timestamptz,
  add column if not exists seat_limit int,
  add column if not exists suspended_at timestamptz;

-- Guards the one value that makes no sense. A zero or negative seat limit
-- would lock an organization out of adding anybody, including its owner.
do $$ begin
  alter table public.firms
    add constraint firms_seat_limit_positive
    check (seat_limit is null or seat_limit > 0);
exception when duplicate_object then null; end $$;

-- Partial index: the HQ trials view asks "who is on a trial", which is a
-- small subset of all organizations.
create index if not exists firms_trial_ends_at_idx
  on public.firms (trial_ends_at)
  where trial_ends_at is not null;

-- One row per HQ action. These are commercial levers, and "who gave that
-- firm another month, and when" is a question that gets asked. The answer
-- should not depend on anybody's memory.
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

create index if not exists firm_trial_events_firm_idx
  on public.firm_trial_events (firm_id, created_at desc);

-- RLS on with NO policy at all. Every read and write goes through
-- lib/firm-trials.ts under isCurrentUserAdmin using the service-role
-- client, so a table closed by default is the correct posture for a
-- commercial control surface. Adding a policy here would be widening
-- access, not enabling a feature.
alter table public.firm_trial_events enable row level security;

commit;
```

- [ ] **Step 2: Confirm you did not apply it**

Run: `git status --porcelain supabase/`
Expected: exactly one added or untracked file, and no change to `supabase/schema-fingerprint.sha256`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260801_firm_trials.sql
git commit -m "Migration: organization trial columns and audit table, not applied

All three columns are nullable and default null, so every existing
organization reads as active and applying this changes no behaviour
until HQ grants a trial.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The server-only query and audit layer

**Files:**
- Create: `lib/firm-trials.ts`

**Interfaces:**
- Consumes: `lib/firm-access.ts` from Task 1, the schema from Task 2.
- Produces: `listTrialFirms()`, `applyTrialAction(input: TrialActionInput)`, `firmTrialState(firmId: string)`, and the type `TrialFirmRow`.

- [ ] **Step 1: Write the module**

```ts
import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { firmAccessState, type FirmAccessState } from '@/lib/firm-access';

/**
 * The only module that reads or writes trial state and the audit table.
 *
 * server-only, because every export here uses the admin client by design:
 * firm_trial_events has RLS on and no policy, so it is closed to every
 * client and reachable only from here, under isCurrentUserAdmin.
 */

export type TrialFirmRow = {
  id: string;
  name: string;
  slug: string;
  trialEndsAt: string | null;
  seatLimit: number | null;
  suspendedAt: string | null;
  memberCount: number;
  state: FirmAccessState;
};

export type TrialAction =
  | { kind: 'granted'; days: number }
  | { kind: 'extended'; days: number }
  | { kind: 'reset'; days: number }
  | { kind: 'suspended' }
  | { kind: 'restored' }
  | { kind: 'seats_changed'; seatLimit: number | null };

export type TrialActionInput = {
  firmId: string;
  actorUserId: string;
  action: TrialAction;
  note: string | null;
};

const DAY_MS = 86_400_000;

export async function listTrialFirms(): Promise<TrialFirmRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  const { data, error } = await admin
    .from('firms')
    .select('id, name, slug, trial_ends_at, seat_limit, suspended_at')
    .or('trial_ends_at.not.is.null,suspended_at.not.is.null')
    .order('trial_ends_at', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('listTrialFirms: could not read firms', error.message);
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    trial_ends_at: string | null;
    seat_limit: number | null;
    suspended_at: string | null;
  }>;
  if (rows.length === 0) return [];

  const { data: memberRows } = await admin
    .from('firm_members')
    .select('firm_id')
    .in('firm_id', rows.map((r) => r.id));

  const counts = new Map<string, number>();
  for (const m of (memberRows ?? []) as Array<{ firm_id: string }>) {
    counts.set(m.firm_id, (counts.get(m.firm_id) ?? 0) + 1);
  }

  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    trialEndsAt: r.trial_ends_at,
    seatLimit: r.seat_limit,
    suspendedAt: r.suspended_at,
    memberCount: counts.get(r.id) ?? 0,
    state: firmAccessState(
      { trialEndsAt: r.trial_ends_at, suspendedAt: r.suspended_at },
      now,
    ),
  }));
}

/** Used by the enforcement layer. Reads the two columns and nothing else. */
export async function firmTrialState(
  firmId: string,
): Promise<FirmAccessState> {
  const admin = createAdminSupabase();
  // Fail OPEN on a missing admin client, because this is the same posture
  // the rest of the app takes when Supabase is unconfigured, and locking
  // every organization out on a config error is worse than the alternative.
  if (!admin) return 'active';

  const { data, error } = await admin
    .from('firms')
    .select('trial_ends_at, suspended_at')
    .eq('id', firmId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('firmTrialState: read failed', error.message);
    return 'active';
  }

  const row = data as { trial_ends_at: string | null; suspended_at: string | null };
  return firmAccessState(
    { trialEndsAt: row.trial_ends_at, suspendedAt: row.suspended_at },
    new Date(),
  );
}

/**
 * Extend moves the existing end date forward. Reset sets it to today plus N.
 * They are separate on purpose: extending a trial that lapsed last week must
 * not silently grant a longer run than intended, and the difference is
 * commercially meaningful.
 *
 * Neither extend nor reset clears suspended_at. A suspended organization
 * stays closed until it is explicitly restored.
 */
export async function applyTrialAction(
  input: TrialActionInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Unavailable. Please try again.' };

  const { data: before } = await admin
    .from('firms')
    .select('trial_ends_at, seat_limit, suspended_at')
    .eq('id', input.firmId)
    .maybeSingle();

  if (!before) return { ok: false, error: 'That organization no longer exists.' };
  const prev = before as {
    trial_ends_at: string | null;
    seat_limit: number | null;
    suspended_at: string | null;
  };

  let patch: Record<string, unknown> = {};
  let previousValue: string | null = null;
  let newValue: string | null = null;

  switch (input.action.kind) {
    case 'granted':
    case 'reset': {
      const next = new Date(Date.now() + input.action.days * DAY_MS);
      patch = { trial_ends_at: next.toISOString() };
      previousValue = prev.trial_ends_at;
      newValue = next.toISOString();
      break;
    }
    case 'extended': {
      const base = prev.trial_ends_at ? new Date(prev.trial_ends_at) : new Date();
      const next = new Date(base.getTime() + input.action.days * DAY_MS);
      patch = { trial_ends_at: next.toISOString() };
      previousValue = prev.trial_ends_at;
      newValue = next.toISOString();
      break;
    }
    case 'suspended': {
      const at = new Date().toISOString();
      patch = { suspended_at: at };
      previousValue = prev.suspended_at;
      newValue = at;
      break;
    }
    case 'restored': {
      patch = { suspended_at: null };
      previousValue = prev.suspended_at;
      newValue = null;
      break;
    }
    case 'seats_changed': {
      patch = { seat_limit: input.action.seatLimit };
      previousValue = prev.seat_limit == null ? null : String(prev.seat_limit);
      newValue =
        input.action.seatLimit == null ? null : String(input.action.seatLimit);
      break;
    }
  }

  const { error: updateErr } = await admin
    .from('firms')
    .update(patch)
    .eq('id', input.firmId);

  if (updateErr) {
    console.error('applyTrialAction: update failed', updateErr.message);
    return { ok: false, error: 'Unavailable. Please try again.' };
  }

  const { error: auditErr } = await admin.from('firm_trial_events').insert({
    firm_id: input.firmId,
    action: input.action.kind,
    actor_user_id: input.actorUserId,
    previous_value: previousValue,
    new_value: newValue,
    note: input.note,
  });

  // The state change already landed. A failed audit write is worth shouting
  // about but must not be reported as a failed action, or an admin will
  // retry and apply it twice.
  if (auditErr) {
    console.error('applyTrialAction: AUDIT WRITE FAILED', auditErr.message);
  }

  return { ok: true };
}
```

- [ ] **Step 2: Type-check, build, commit**

```bash
npx tsc --noEmit && npm run build
git add lib/firm-trials.ts
git commit -m "Add the server-only trial query and audit layer

Extend moves the existing end date forward, reset sets it to today plus
N, and neither clears a suspension, so a date change cannot reopen an
organization that was closed deliberately.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Enforcement, both layers

**Files:**
- Modify: `app/counsel/layout.tsx`
- Modify: `app/portal/layout.tsx`
- Create: `app/counsel/access-ended/page.tsx`
- Modify: `lib/firm-authz.ts`
- Test: `tests/firm-access.test.ts` (extend)

**Interfaces:**
- Consumes: `firmTrialState` from Task 3, `firmAccessState` from Task 1.
- Produces: `requireActiveFirm(firmId: string): Promise<void>` exported from `lib/firm-authz.ts`, which throws when the organization is `export_only`.

**Read "The two-layer rule" at the top of this plan before starting.** Both halves are required. A redirect in a layout is a courtesy to a browser; the gate is the refusal inside the write path.

- [ ] **Step 1: Add the shell redirect**

In `app/counsel/layout.tsx`, after `getActiveFirmContext` resolves and alongside the existing redirects at `:97`, `:125`, `:129`, `:188` and `:195`, call `firmTrialState(ctx.firm.id)` and redirect to `/counsel/access-ended` when it returns `'export_only'`. Do the same in `app/portal/layout.tsx`.

The `/counsel/access-ended` route must NOT itself redirect, or it loops.

- [ ] **Step 2: Add the action-side gate**

Add to `lib/firm-authz.ts`:

```ts
/**
 * Refuses when the organization's access has ended.
 *
 * This is the gate. The layout redirect is a courtesy to a browser: every
 * 'use server' export is a public HTTP endpoint and is callable directly
 * regardless of what the UI shows. This codebase has shipped that exact
 * defect twice, on the intake form path and on document release.
 */
export async function requireActiveFirm(firmId: string): Promise<void> {
  const { firmTrialState } = await import('@/lib/firm-trials');
  const state = await firmTrialState(firmId);
  if (state !== 'active') {
    throw new Error('This organization’s access has ended.');
  }
}
```

- [ ] **Step 3: Write the access-ended page**

Owner and admin see the export. Everyone else sees an explanation naming who to speak to. Roles come from `lib/firm-authz.ts`.

Copy, exactly, and note that it does NOT say anything is being deleted:

- Heading: **Your organization's access has ended**
- Body for owner and admin: **You can still download everything your organization has in Advottic. Your data is not being deleted.**
- Body for everyone else: **An owner or an administrator at your organization can download your data. Speak to them if you need something from here.**

- [ ] **Step 4: Add the seat check to the member-add path**

Find where a firm adds a member and call `seatCheck` before the insert, refusing with a message naming the limit. Existing members over a lowered limit are untouched.

- [ ] **Step 5: Prove the gate is real, by mutation**

Add a test that `requireActiveFirm` throws for an `export_only` organization, then break it and confirm the test goes red:

1. Change `if (state !== 'active')` to `if (false)`. Expected red: the new test.

If it stays green, the gate is unpinned and the test is decoration. This exact failure happened on the document release work in this repo: a concurrency test passed with the concurrency control fully deleted, because it only ever exercised the sequential path.

- [ ] **Step 6: Type-check, build, test, commit**

```bash
npx tsc --noEmit && npm run build && npx vitest run
git add app/counsel/layout.tsx app/portal/layout.tsx app/counsel/access-ended lib/firm-authz.ts tests/firm-access.test.ts
git commit -m "Close the product when an organization's access has ended

Two layers, both required. The layout redirect is a courtesy to a
browser; the gate is requireActiveFirm inside the write paths, because
every 'use server' export is a public HTTP endpoint.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The organization export

**Files:**
- Create: `app/api/firm/export/route.ts`

**Interfaces:**
- Consumes: `lib/firm-authz.ts` for the role check.
- Produces: `GET /api/firm/export` returning a JSON archive of the caller's organization.

Follow `app/api/account/export/route.ts`: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and `logSecurityEvent` plus `requestMeta` from `lib/security-audit`.

- [ ] **Step 1: Write the route**

**Owner and admin only.** An organization export contains every matter, document and client name the firm holds. A paralegal downloading the whole firm on their way out is a data loss incident, not an offboarding feature. Use `callerHasFirmRole` with owner and admin; do not write a new check.

It must work while the organization is `export_only`. That is the whole point, so this route is exempt from `requireActiveFirm`. Say so in a comment, because it looks like an oversight otherwise.

Log every export through `logSecurityEvent`. A whole-organization download is exactly the event an audit wants to see.

- [ ] **Step 2: Type-check, build, commit**

```bash
npx tsc --noEmit && npm run build
git add app/api/firm/export
git commit -m "Add the organization-scoped data export

Owner and admin only, and deliberately exempt from requireActiveFirm,
because retrieving your data after access ends is the reason it exists.
Every export is logged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The HQ trials view and its actions

**Files:**
- Create: `lib/firm-trial-actions.ts`
- Create: `app/admin/firms/trial-controls.tsx`
- Modify: `app/admin/firms/page.tsx`

**Interfaces:**
- Consumes: `listTrialFirms` and `applyTrialAction` from Task 3.
- Produces: five `'use server'` actions, each resolving `isCurrentUserAdmin` itself.

- [ ] **Step 1: Write the actions**

Every export in `lib/firm-trial-actions.ts` is a public HTTP endpoint. Each one resolves `isCurrentUserAdmin()` FIRST and refuses otherwise. None accepts a caller-supplied admin claim. Follow the gate at `app/admin/layout.tsx:90-91`.

Five: `grantTrialAction`, `extendTrialAction`, `resetTrialAction`, `setSeatLimitAction`, `setSuspendedAction`.

- [ ] **Step 2: Write the controls and the view**

`app/admin/firms/trial-controls.tsx` follows the existing client-component pattern beside `SubdomainToggle`, `BrandingEditor` and `ImpersonateOwnerButton`.

The view lists organization, trial end date, days remaining, seats used against limit, and state. Where an organization is both suspended and carries a future end date, say so, rather than showing a future date beside a closed organization with no explanation.

- [ ] **Step 3: Type-check, build, commit**

```bash
npx tsc --noEmit && npm run build
git add lib/firm-trial-actions.ts app/admin/firms
git commit -m "Add the HQ trials view and its five actions

Every action resolves isCurrentUserAdmin itself rather than trusting the
layout, and every one writes an audit row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Compliance note and final verification

**Files:**
- Create or modify: `docs/compliance/` retention note

- [ ] **Step 1: Record the retention posture**

Organizations that lapse now retain their data indefinitely until they ask for deletion. That is a deliberate choice and it belongs in `docs/compliance/` beside the existing risk register, stated as what it is. Make no certified claim anywhere.

Include the reasoning, so it outlives the decision: automatic deletion was considered and rejected because Advottic holds matters under litigation hold, records that HIPAA and state bar rules require kept for years, and data belonging partly to clients and signers who never agreed to the trial terms.

- [ ] **Step 2: Run every gate**

```bash
npx tsc --noEmit
npm run build
npx vitest run
npm run test:audit-guards
```

`test:audit-guards` fails on `main` today with 11 pre-existing unreviewed `<T>` wraps. Report the count before and after. This branch must not add a twelfth.

- [ ] **Step 3: Sweep the constraints**

Grep your own diff for em dashes and emoji. Confirm `package.json` is unchanged. **Then grep every string you added for the words "delete", "deleted", "deletion" and "removed", and confirm none of them promises the organization's data will be destroyed.** Under this design it will not be, and saying otherwise is a false statement to a customer, not a copy nit.

- [ ] **Step 4: State what you could not verify**

The migration is unapplied, so no organization has ever had a trial, no action has written an audit row, and the enforcement layers have never refused a real request. **Applying the migration and regenerating `supabase/schema-fingerprint.sha256` is the CONTROLLER'S step.** Do not apply it, do not fake it, do not drop it from your report. Write out the checklist:

1. Apply `supabase/migrations/20260801_firm_trials.sql` and regenerate the fingerprint in the same change.
2. Grant a trial to a test organization from HQ and confirm the row and the audit event.
3. Set the end date into the past and confirm counsel and portal both redirect to `/counsel/access-ended`.
4. Confirm an owner sees the export there and a paralegal sees the explanation.
5. Call a firm write action directly while `export_only` and confirm it refuses, which is the half a browser cannot test.
6. Extend, and confirm access returns on the next page load with no job having run.
7. Suspend, extend, and confirm the organization stays closed.
8. Set a seat limit below the current member count and confirm nobody is ejected and the next add is refused.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Record the trial retention posture and close the gates

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** State and the deciding function to Task 1. Data model to Task 2. Query and audit to Task 3. Both enforcement layers, the access-ended page and seats to Task 4. The export, including its owner-and-admin restriction, to Task 5. HQ view and the five actions, including the extend-versus-reset distinction and suspension outranking dates, to Tasks 3 and 6. Compliance to Task 7. The copy requirement is in the Global Constraints and is checked explicitly in Task 7 Step 3.

**Placeholders.** None. Tasks 1 to 3 carry complete code. Tasks 4 to 6 specify exact files, exact copy and exact rules; their code is conventional composition against interfaces defined above, and every value an implementer must not invent is written out.

**Type consistency.** `FirmTimestamp`, `FirmAccessInput`, `FirmAccessState`, `SeatCheckInput` and `SeatCheckResult` are defined in Task 1 and consumed unchanged in Tasks 3 and 4. `firmAccessState` and `seatCheck` keep their names throughout. `firmTrialState` is defined in Task 3 and used in Task 4. `applyTrialAction` and `TrialActionInput` are defined in Task 3 and used in Task 6.

**Known gap, stated rather than hidden.** Tasks 4 to 6 touch auth-gated surfaces, and no agent in this session has been able to sign in, so those are verified by types, tests and the Task 7 checklist rather than by eye. The logic that decides access is pure and fully tested in Task 1, which is where the correctness risk actually sits.
