-- Supporting schema for the HQ Security pulse dashboard.
--
-- 1. security_events: append-only feed of suspicious activity. The HQ
--    dashboard aggregates open events by severity, and the pulse
--    engine reads the table to surface attacks (login spikes, etc.).
-- 2. hq_settings: a tiny key/value store for cross-cutting flags the
--    pulse engine flips when an autofix runs (eg.
--    `auth_strict_rate_limit_until` -> ISO timestamp).
-- 3. hq_check_rls(p_tables text[]): RPC the pulse engine calls to
--    verify row-level security is on for the platform's critical
--    tables. Returns one row per table with rls_enabled boolean.
-- 4. firm_integrations.needs_reconnect: boolean flag set when the
--    pulse engine's autofix forces a stale token to re-auth. The
--    /counsel/meetings UI surfaces this as a yellow "Reconnect"
--    button next to the integration card.
--
-- All four pieces are independently optional - the pulse dashboard
-- gracefully degrades (status: 'unknown') for any check whose backing
-- object is not yet present.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- security_events
-- ---------------------------------------------------------------------------
-- Corrected 2026-08-06 to match the live table. This file previously
-- declared `ip_address inet`, `metadata jsonb` and `acknowledged_by`, none
-- of which exist in production; the real columns are `ip`, `url` and
-- `details`, and there is no foreign key on `user_id` (account-deletion
-- audit rows outlive the auth.users row they describe). The stale
-- definition is what `lib/security-audit.ts` was written against.
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  kind text not null,
  severity text not null default 'low'
    constraint security_events_severity_check
    check (severity in ('low','medium','high','critical')),
  user_id uuid,
  ip text,
  user_agent text,
  url text,
  details jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz
);

-- Reconcile any environment that was provisioned from the stale definition
-- above. Every branch is a no-op on production, which already has the
-- correct shape, so this changes no live object and no schema fingerprint.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'security_events'
      and column_name = 'ip_address'
  ) then
    alter table public.security_events rename column ip_address to ip;
    alter table public.security_events alter column ip type text using ip::text;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'security_events'
      and column_name = 'metadata'
  ) then
    alter table public.security_events rename column metadata to details;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'security_events'
      and column_name = 'url'
  ) then
    alter table public.security_events add column url text;
  end if;
end $$;

create index if not exists security_events_open_idx
  on public.security_events (severity, occurred_at desc)
  where acknowledged_at is null;

create index if not exists security_events_kind_occurred_idx
  on public.security_events (kind, occurred_at desc);

alter table public.security_events enable row level security;

-- HQ admins read everything; authenticated users can never reach this
-- table directly. The service role bypasses RLS for inserts from the
-- application's auth pipeline.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'security_events'
      and policyname = 'security_events_admin_select'
  ) then
    create policy security_events_admin_select on public.security_events
      for select to authenticated
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and is_admin = true
        )
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'security_events'
      and policyname = 'security_events_admin_update'
  ) then
    create policy security_events_admin_update on public.security_events
      for update to authenticated
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and is_admin = true
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- hq_settings (small key/value store for HQ-only flags)
-- ---------------------------------------------------------------------------
create table if not exists public.hq_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.hq_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hq_settings'
      and policyname = 'hq_settings_admin_all'
  ) then
    create policy hq_settings_admin_all on public.hq_settings
      for all to authenticated
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and is_admin = true
        )
      )
      with check (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and is_admin = true
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- hq_check_rls: RPC for the pulse engine
-- ---------------------------------------------------------------------------
create or replace function public.hq_check_rls(p_tables text[])
returns table(table_name text, rls_enabled boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Restrict to admin callers. The function runs as the owner so the
  -- inner query can read pg_class regardless of the caller's grants;
  -- the explicit admin gate prevents non-admins from probing.
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'hq_check_rls: caller is not an admin';
  end if;
  return query
    select t::text as table_name,
           coalesce(c.relrowsecurity, false) as rls_enabled
    from unnest(p_tables) as t
    left join pg_class c on c.relname = t and c.relnamespace = 'public'::regnamespace;
end;
$$;

revoke all on function public.hq_check_rls(text[]) from public;
grant execute on function public.hq_check_rls(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- firm_integrations.needs_reconnect (autofix target)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firm_integrations'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firm_integrations'
      and column_name = 'needs_reconnect'
  ) then
    alter table public.firm_integrations
      add column needs_reconnect boolean not null default false;
  end if;
end $$;

comment on column public.firm_integrations.needs_reconnect is
  'Set true by the HQ Security pulse autofix `mark_integrations_needs_reconnect` when a token is stale and not refreshing. The /counsel/meetings UI surfaces this as a "Reconnect" button.';
