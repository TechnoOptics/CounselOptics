-- Enterprise employee directory - 2026-05-18
--
-- Why this exists
-- ---------------
-- An enterprise tenant (Firm with firm_type = 'corporate') has two
-- populations:
--   * the legal department  -> firm_members rows, full /counsel/* app
--   * everyone else (employees) -> THIS table, scoped /portal/* only
--
-- Employees are deliberately NOT firm_members: a firm_members row
-- implies a legal-team seat (and billing) and unlocks the full
-- Counsel app + its RLS. An employee must never reach /counsel/*,
-- so they get their own row type and their own minimal surface.
--
-- Provisioning
-- ------------
--  * Tier 2 (now): an admin adds employees by hand, or they self-
--    register against the tenant. source = 'manual'.
--  * Tier 3 (later, needs Zinpro IT): SCIM / Entra / Google Directory
--    sync upserts rows with source = 'azure' | 'google' and an
--    external_id. Deprovisioning sets deactivated_at (never hard
--    delete - request history must survive).
--
-- See docs/ENTERPRISE_WORKSPACE.md for the full design.
--
-- Security
-- --------
--  * RLS on. A user may read ONLY their own employee row (this is the
--    persona signal the portal layout reads). All listing/management
--    for admins goes through the service-role client in server
--    actions, same pattern as lib/notifications.ts - so no admin
--    read policy here, which also sidesteps the firm_members RLS
--    recursion class of bug (see 2026-05-02 fix).

create table if not exists public.firm_employees (
  id             uuid primary key default gen_random_uuid (),
  firm_id        uuid not null references public.firms (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete set null,
  email          text not null,
  display_name   text,
  department     text,
  source         text not null default 'manual'
                   check (source in ('manual', 'azure', 'google')),
  external_id    text,
  deactivated_at timestamptz,
  created_at     timestamptz not null default now(),
  -- One row per person per firm. Email is the stable key before a
  -- user_id exists (invited but not yet signed in); the directory
  -- sync upserts on (firm_id, email).
  unique (firm_id, email)
);

create index if not exists firm_employees_user_idx
  on public.firm_employees (user_id);
create index if not exists firm_employees_firm_idx
  on public.firm_employees (firm_id);

alter table public.firm_employees enable row level security;

-- A user can see their own employee row(s) only. This is what the
-- /portal layout uses to resolve "am I an employee of this firm".
drop policy if exists firm_employees_self_select on public.firm_employees;
create policy firm_employees_self_select
  on public.firm_employees
  for select
  using (user_id = auth.uid ());

-- No insert/update/delete policies and no admin-read policy on
-- purpose: every write and every admin listing goes through the
-- service-role client in server actions.
