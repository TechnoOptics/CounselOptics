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
