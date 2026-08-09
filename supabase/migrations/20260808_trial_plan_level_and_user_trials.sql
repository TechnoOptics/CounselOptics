-- Trials carry a plan level, and individual users can be put on one.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-06. Applying this and regenerating
-- supabase/schema-fingerprint.sha256 is the OWNER'S step, not an
-- implementer's. The CI drift gate is designed to hash the live schema
-- against that committed fingerprint, but it is not doing so: it skips
-- while the SUPABASE_DB_URL secret is unset, so applying one without the
-- other fails nothing. See scripts/schema/README.md, "Current status".
-- =========================================================================
--
-- ORDERING. This file runs AFTER supabase/migrations/20260801_firm_trials.sql,
-- which is itself still unapplied. That file creates public.firm_trial_events
-- and adds firms.trial_ends_at; the ALTER below widens that table's action
-- constraint, so applying this one first fails on a table that does not exist
-- yet. The file names sort in the right order. Do not renumber either one, and
-- do not edit 20260801_firm_trials.sql to fold this in: it has been through
-- review and the pending-merge ordering depends on it staying as it is.
--
-- WHY trial_tier IS A BARE text COLUMN WITH NO VALUE CHECK. The set of plan
-- levels this product sells is derived from PRICE_TABLE in lib/entitlements.ts
-- and exported as ENTITLEMENT_TIER_SLUGS. A CHECK constraint listing those
-- values here would be a SECOND copy of the entitlement vocabulary, in a
-- language that cannot import the first, and it would go stale the first time
-- a rung is added to the price table. A second list of what a tier means is a
-- second place to get entitlement wrong.
--
-- What protects the column instead is that both readers refuse a value they do
-- not recognise. lib/trial-entitlement.ts narrows the stored text through
-- isEntitlementTierSlug before it can grant anything, and an unrecognised
-- level resolves to NO trial rather than to some default. The HQ actions
-- validate against the same list before writing. So the worst a bad value can
-- do is grant nothing, which is the fail-closed direction.

begin;

-- ---------------------------------------------------------------------------
-- 1. Organization trials get a plan level.
-- ---------------------------------------------------------------------------

alter table public.firms
  add column if not exists trial_tier text;

-- The action vocabulary of the audit table has to grow with the levers, or
-- every audit insert for the new one fails. lib/firm-trials.ts treats a failed
-- audit write as a warning rather than a failed action, deliberately, so
-- forgetting this would be a SILENT GAP in the trail rather than a visible
-- error. The constraint is dropped and recreated because a CHECK cannot be
-- widened in place. The name is the one Postgres generates for an inline
-- column check, `<table>_<column>_check`, and `if exists` keeps this
-- re-runnable.
alter table public.firm_trial_events
  drop constraint if exists firm_trial_events_action_check;

alter table public.firm_trial_events
  add constraint firm_trial_events_action_check check (action in
    ('granted', 'extended', 'reset', 'suspended', 'restored', 'seats_changed',
     'tier_changed'));

-- ---------------------------------------------------------------------------
-- 2. Individual users get trials, mirroring the organization design.
-- ---------------------------------------------------------------------------
--
-- Columns on profiles rather than a metadata jsonb blob, for the same reason
-- the organization columns sit on firms: these are read on the path that
-- decides what the account is entitled to, and a hot read should not be
-- digging through jsonb.
--
-- Both are nullable and default to null, so applying this is invisible. Every
-- existing user has no trial and no trial level, which the resolver reads as
-- "no uplift", and behaviour is unchanged until HQ grants one.
--
-- There is deliberately NO trial_suspended_at here, and its absence is a
-- decision rather than an omission. The organization side needed a suspension
-- because a firm had no other closed state. An individual already has one:
-- profiles.is_blocked, driven by setUserBlockedAction and shown as the Active
-- toggle in HQ. A second lockout flag would mean two answers to "is this
-- account closed", and the two would disagree the first time only one of them
-- was set.

alter table public.profiles
  add column if not exists trial_ends_at timestamptz,
  add column if not exists trial_tier text;

-- Partial, because a user on a trial is a small subset of all users and a
-- partial index does not carry the majority that are null. There is only one
-- branch to cover here, unlike the organization query, because there is no
-- second nullable column to disjoin with.
create index if not exists profiles_trial_ends_at_idx
  on public.profiles (trial_ends_at)
  where trial_ends_at is not null;

-- One row per HQ action on a user trial. Same columns, same posture and the
-- same reasoning as public.firm_trial_events:
--
--   The actor is recorded TWICE, as an id and as a denormalised email, and the
--   email is the half that survives. A bare uuid answers "who" only for as
--   long as that user row exists.
--
--   Deliberately NO foreign key on actor_user_id. An `on delete restrict`
--   reference would buy the same durability by making the admin undeletable,
--   which is real friction against an erasure request. Denormalising the email
--   buys it without holding a person's account hostage to an audit trail.
--
--   Both actor columns are nullable with no default, so the table stays
--   writable by a caller that has only one of the two.
--
-- The action values differ from the organization table because the levers do.
-- There is no seat limit on an individual, and no suspension for the reason
-- given above; 'tier_changed' sets the plan level and 'cleared' takes the
-- account off the clock entirely.
create table if not exists public.user_trial_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in
    ('granted', 'extended', 'reset', 'tier_changed', 'cleared')),
  actor_user_id uuid,
  actor_email text,
  previous_value text,
  new_value text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists user_trial_events_user_idx
  on public.user_trial_events (user_id, created_at desc);

-- RLS on with NO policy at all, matching firm_trial_events exactly. Every read
-- and write goes through lib/user-trials.ts on the service-role client under
-- isCurrentUserAdmin, so a table closed by default is the correct posture for
-- a commercial control surface. Adding a policy here would be widening access,
-- not enabling a feature.
alter table public.user_trial_events enable row level security;

commit;
