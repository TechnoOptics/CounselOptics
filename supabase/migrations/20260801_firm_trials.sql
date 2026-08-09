-- Organization trial lifecycle: expiry, seats, suspension, and an audit trail.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-01. The owner applies this and regenerates
-- supabase/schema-fingerprint.sha256 in the same change. Nothing in CI
-- will notice if they forget: the schema-drift gate skips while the
-- SUPABASE_DB_URL secret is unset. See scripts/schema/README.md,
-- "Current status".
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

-- Two partial indexes, one per branch of ONE query. The HQ trials view asks
-- "which organizations has HQ touched", which is a disjunction:
--
--   trial_ends_at is not null or suspended_at is not null
--
-- Both branches must be indexable or neither index is used. Postgres can
-- combine two index scans across an OR with a BitmapOr, but only when it has
-- an index for every branch; leave suspended_at unindexed and the planner
-- gives up and sequentially scans the whole table, so the trial_ends_at index
-- would be paid for and never read. They are partial because an organization
-- on a trial or under suspension is a small subset of all organizations, and
-- a partial index does not carry the majority that are null on both.
create index if not exists firms_trial_ends_at_idx
  on public.firms (trial_ends_at)
  where trial_ends_at is not null;

create index if not exists firms_suspended_at_idx
  on public.firms (suspended_at)
  where suspended_at is not null;

-- One row per HQ action. These are commercial levers, and "who gave that
-- firm another month, and when" is a question that gets asked. The answer
-- should not depend on anybody's memory.
--
-- The actor is recorded TWICE, as an id and as a denormalised email, and the
-- email is the part that survives. A bare actor_user_id answers "who" only for
-- as long as that user row exists; delete the admin and every event they ever
-- wrote degrades to an unresolvable uuid. The row would be preserved and the
-- answer lost, which defeats the point of keeping the row.
--
-- Deliberately NO foreign key on actor_user_id. The obvious fix, the
-- `references auth.users(id) on delete restrict` that
-- supabase/fixes/2026-05-12-admin-impersonations.sql uses, buys the same
-- durability by making the admin undeletable, which is real friction against a
-- GDPR erasure request. Denormalising the email buys it without holding a
-- person's account hostage to an audit trail.
--
-- Both actor columns are nullable with no default, so this table stays
-- writable by any caller that has only one of the two.
create table if not exists public.firm_trial_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  action text not null check (action in
    ('granted', 'extended', 'reset', 'suspended', 'restored', 'seats_changed')),
  actor_user_id uuid,
  actor_email text,
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
