-- P1-6 fix from the 2026-05-12 audit.
--
-- The audit flagged two missing pieces:
--   1. `firm_integrations` table - referenced by
--      app/api/integrations/[provider]/callback/route.ts and
--      lib/integration-tokens.ts but never created. OAuth flows for
--      Microsoft / Zoom / Google calendar silently fail on insert.
--   2. `hq_check_rls(p_tables text[])` function - referenced by the
--      HQ Security Pulse autofix engine; the wider migration in
--      2026-05-05-security-pulse.sql was written, but the audit
--      indicates it was never applied to production (the dashboard
--      shows "unknown" for the RLS check).
--
-- This file is the safe re-apply. Everything is wrapped in
-- `create ... if not exists` / `do $$ ... end $$` guards so running
-- it twice is a no-op. Run via Supabase Dashboard -> SQL Editor.
--
-- Touches:
--   - public.firm_integrations (new table + RLS)
--   - public.firm_integrations.needs_reconnect (column)
--   - public.hq_check_rls (function)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- firm_integrations: per-firm OAuth connection (Microsoft Graph / Zoom /
-- Google) that powers the /counsel/meetings UI. Tokens are stored as
-- AES-GCM-encrypted byte arrays (see lib/integration-tokens.ts) so a
-- raw DB read from a leaked service key still doesn't yield usable
-- credentials.
-- ---------------------------------------------------------------------------
create table if not exists public.firm_integrations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- Provider id matches lib/integration-oauth.ts (e.g. 'microsoft', 'zoom', 'google').
  provider text not null,
  -- Account the firm connected on the provider side. Surfaced as
  -- "Connected as alice@firm.com" in the integrations UI.
  account_email text,
  account_display_name text,
  -- AES-GCM envelope. See lib/integration-tokens.ts for the format
  -- (version byte + 12-byte IV + 16-byte tag + ciphertext).
  access_token_encrypted bytea,
  refresh_token_encrypted bytea,
  -- Pre-computed expiry for the access token. The refresh job uses
  -- this to decide which rows to touch instead of decrypting every
  -- token on a cron tick.
  expires_at timestamptz,
  -- Space-separated scope string returned by the provider.
  scope text,
  -- Who pressed the Connect button. Useful for support so a member
  -- can ask "who set up Zoom for us last quarter".
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  -- Two-stage delete: revoked_at is set when a firm explicitly
  -- disconnects. Row is kept for audit; tokens are wiped on revoke.
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  -- True when the HQ Security Pulse autofix or the refresh job sees
  -- a stale token that isn't refreshing. UI surfaces a "Reconnect"
  -- button when true.
  needs_reconnect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active connection per (firm, provider). Re-connecting upserts.
create unique index if not exists firm_integrations_firm_provider_uniq
  on public.firm_integrations (firm_id, provider);

create index if not exists firm_integrations_needs_reconnect_idx
  on public.firm_integrations (firm_id)
  where needs_reconnect = true;

-- updated_at trigger so the refresh job's writes show in the UI.
create or replace function public.firm_integrations_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists firm_integrations_touch_updated_at on public.firm_integrations;
create trigger firm_integrations_touch_updated_at
  before update on public.firm_integrations
  for each row execute function public.firm_integrations_touch_updated_at();

alter table public.firm_integrations enable row level security;

-- ---------------------------------------------------------------------------
-- RLS policies
--   - Firm members can SELECT their firm's integration rows so the
--     "Connected as ..." badge renders.
--   - Firm OWNERS / ADMINS can UPDATE (mostly to set revoked_at or
--     clear needs_reconnect after re-connecting).
--   - INSERT / DELETE are NEVER permitted to authenticated callers;
--     the OAuth callback runs with the service-role client which
--     bypasses RLS entirely. This prevents anyone from forging a
--     row that claims to be a valid Microsoft / Zoom connection.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'firm_integrations'
      and policyname = 'firm_integrations_member_select'
  ) then
    create policy firm_integrations_member_select on public.firm_integrations
      for select to authenticated
      using (
        exists (
          select 1 from public.firm_members fm
          where fm.firm_id = firm_integrations.firm_id
            and fm.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'firm_integrations'
      and policyname = 'firm_integrations_admin_update'
  ) then
    create policy firm_integrations_admin_update on public.firm_integrations
      for update to authenticated
      using (
        exists (
          select 1 from public.firm_members fm
          where fm.firm_id = firm_integrations.firm_id
            and fm.user_id = auth.uid()
            and fm.role in ('owner', 'admin')
        )
      )
      with check (
        exists (
          select 1 from public.firm_members fm
          where fm.firm_id = firm_integrations.firm_id
            and fm.user_id = auth.uid()
            and fm.role in ('owner', 'admin')
        )
      );
  end if;
end $$;

comment on table public.firm_integrations is
  'Per-firm OAuth connection (Microsoft / Zoom / Google) powering /counsel/meetings. Tokens are AES-GCM encrypted via lib/integration-tokens.ts.';
comment on column public.firm_integrations.needs_reconnect is
  'Set true by the HQ Security Pulse autofix `mark_integrations_needs_reconnect` when a token is stale and not refreshing. UI surfaces a "Reconnect" button when true.';

-- ---------------------------------------------------------------------------
-- hq_check_rls: RPC for the HQ Security pulse engine.
-- Re-applied here to cover the case where 2026-05-05-security-pulse.sql
-- was never run against the production database (the audit shows the
-- check status as "unknown" on the dashboard, which is the file's
-- documented degraded state). `create or replace` is idempotent.
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

-- Verify both pieces are present.
do $$
declare
  has_table boolean;
  has_fn boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'firm_integrations'
  ) into has_table;
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'hq_check_rls'
  ) into has_fn;
  raise notice '[2026-05-12 audit P1-6] firm_integrations table: %, hq_check_rls fn: %',
    case when has_table then 'OK' else 'MISSING' end,
    case when has_fn then 'OK' else 'MISSING' end;
end $$;
