-- Audit V5 CR-21 (part 3) follow-up — 2026-05-14
--
-- BACKGROUND
-- The 2026-05-12-firm-integrations-and-rls-check.sql migration was
-- applied to production, but `created_at` and `updated_at` were
-- missing from the live `firm_integrations` table. Production also
-- had a stricter `access_token_encrypted NOT NULL` than the source
-- declared, so dropping in the canonical migration on a greenfield
-- box would have produced a different schema than what HQ has been
-- running against.
--
-- ROOT CAUSE
-- The original 2026-05-12 migration's `create table if not exists`
-- guard fired against a hand-rolled pre-existing definition (probably
-- from an early "OAuth POC" branch). Because the table existed,
-- Postgres skipped the table body entirely - none of the column
-- additions ran. The trigger definition went through anyway because
-- it's a `drop trigger if exists` + `create trigger`, and it has been
-- crashing every UPDATE since (`column "updated_at" does not exist`).
--
-- The audit kept flagging "RLS check function returns unknown" because
-- the only path the Security Pulse engine has to mark a stale token
-- (`needs_reconnect = true`) is an UPDATE - which was throwing.
--
-- WHAT THIS DOES
--   1. Adds `created_at` / `updated_at` columns idempotently.
--   2. Re-affirms the touch-updated_at trigger so the function it
--      bound to is the current definition.
--   3. Brings the canonical schema in line with the live constraint
--      so the next reset migration doesn't drift back.
--   4. Adds a verification DO block that fails loudly if anything
--      isn't where it should be.
--
-- This is idempotent: running it twice is a no-op.

alter table public.firm_integrations
  add column if not exists created_at timestamptz not null default now();

alter table public.firm_integrations
  add column if not exists updated_at timestamptz not null default now();

-- Match the live NOT NULL on access_token_encrypted (the OAuth
-- callback always writes the column on first upsert, so this is the
-- correct schema, not the original migration's nullable declaration).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='firm_integrations'
      and column_name='access_token_encrypted' and is_nullable='YES'
  ) then
    alter table public.firm_integrations
      alter column access_token_encrypted set not null;
  end if;
end $$;

-- Re-affirm the trigger fn (idempotent).
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

-- Verification: fail loud if anything is still missing.
do $$
declare
  has_created boolean;
  has_updated boolean;
  has_trigger boolean;
  has_fn boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='firm_integrations' and column_name='created_at'
  ) into has_created;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='firm_integrations' and column_name='updated_at'
  ) into has_updated;
  select exists (
    select 1 from pg_trigger
    where tgname='firm_integrations_touch_updated_at' and tgrelid='public.firm_integrations'::regclass
  ) into has_trigger;
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='firm_integrations_touch_updated_at'
  ) into has_fn;

  if not (has_created and has_updated and has_trigger and has_fn) then
    raise exception '[audit V5 CR-21] firm_integrations schema not fully repaired: created_at=%, updated_at=%, trigger=%, fn=%',
      has_created, has_updated, has_trigger, has_fn;
  end if;
  raise notice '[audit V5 CR-21] firm_integrations schema verified.';
end $$;
