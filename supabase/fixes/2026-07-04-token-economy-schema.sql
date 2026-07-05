-- TOKEN-ECONOMY + FIRM-CORE TABLE DDL (reference of record).
--
-- The 2026-07-04 audit flagged that the token economy and the firm-core
-- root tables live ONLY in the live database, with no CREATE TABLE in
-- source. The prior firm-core-rls-snapshot.sql captured their RLS as a
-- comment reference but explicitly deferred the DDL; this file is that
-- deferred follow-up. Consequences of the gap it closes:
--   * A restore purely from tracked SQL produced a DB where every token
--     debit/grant/top-up errored (missing tables/columns) and every
--     sandbox-filtered query 42703'd - and the case-limit block, which
--     reads cases.sandbox, then failed open (unlimited case creation).
--   * token_topup_purchases' idempotency (relied on by the Stripe
--     webhook + applyTopupPurchase) rests on UNIQUE(stripe_payment_intent_id),
--     which was untracked and thus un-reviewable.
--
-- This is a verbatim, idempotent snapshot of LIVE as of 2026-07-04,
-- reconstructed from information_schema / pg_constraint / pg_indexes /
-- pg_policies. Every statement is IF NOT EXISTS / guarded, so applying
-- it against prod is a no-op and applying it to a fresh restore rebuilds
-- the objects. Column order, types, defaults, constraints, indexes and
-- the token-table RLS policies match prod exactly.
--
-- RLS note: firms / firm_members SELECT/INSERT/UPDATE policies are the
-- tenant boundary documented in 2026-07-03-firm-core-rls-snapshot.sql
-- and are managed there; this file only guarantees RLS is ENABLED on
-- them (deny-by-default is the safe state on a fresh restore - the
-- service-role client the app uses for firm writes bypasses RLS). The
-- two token tables' policies WERE fully untracked, so they are made
-- executable here.

begin;

-- ── firms (multi-tenant root) ────────────────────────────────────────
create table if not exists public.firms (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  logo_url          text,
  accent_color      text not null default '#0f2d24'::text,
  jurisdictions     text[] not null default '{}'::text[],
  practice_areas    text[] not null default '{}'::text[],
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  firm_type         text not null default 'firm'::text
                      check (firm_type = any (array['individual','firm','corporate','government','legal_aid','other'])),
  metadata          jsonb not null default '{}'::jsonb,
  subdomain_enabled boolean not null default false,
  token_pool_balance    bigint not null default 0,
  token_pool_period_end timestamptz,
  letterhead_url    text
);
-- Columns added to firms after its original creation (idempotent for an
-- existing prod table that predates the token-pool / letterhead work).
alter table public.firms add column if not exists token_pool_balance    bigint not null default 0;
alter table public.firms add column if not exists token_pool_period_end timestamptz;
alter table public.firms add column if not exists letterhead_url text;

create index if not exists firms_slug_idx       on public.firms using btree (slug);
create index if not exists firms_lower_slug_idx on public.firms using btree (lower(slug));
create index if not exists firms_type_idx       on public.firms using btree (firm_type);

alter table public.firms enable row level security;

-- ── firm_members (membership + role, the tenant authorization anchor) ─
create table if not exists public.firm_members (
  id                uuid primary key default gen_random_uuid(),
  firm_id           uuid not null references public.firms(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              text not null
                      check (role = any (array['owner','admin','attorney','paralegal','staff'])),
  display_name      text,
  joined_at         timestamptz not null default now(),
  default_rate_cents integer,
  unique (firm_id, user_id)
);
create index if not exists firm_members_firm_idx on public.firm_members using btree (firm_id);
create index if not exists firm_members_user_idx on public.firm_members using btree (user_id);

alter table public.firm_members enable row level security;

-- ── token_ledger (append-only record of every token movement) ─────────
create table if not exists public.token_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  occurred_at   timestamptz not null default now(),
  delta         integer not null,
  reason        text not null,
  balance_after integer,
  metadata      jsonb not null default '{}'::jsonb,
  firm_id       uuid references public.firms(id) on delete set null
);
create index if not exists idx_token_ledger_user_time on public.token_ledger using btree (user_id, occurred_at desc);
create index if not exists token_ledger_firm_idx on public.token_ledger using btree (firm_id, occurred_at desc) where (firm_id is not null);

alter table public.token_ledger enable row level security;
-- Reads: a user sees only their own ledger. Writes go exclusively
-- through the atomic debit/credit SECURITY DEFINER RPCs + service-role,
-- so there is deliberately NO insert/update/delete policy.
drop policy if exists "users read own ledger" on public.token_ledger;
create policy "users read own ledger" on public.token_ledger
  for select to authenticated
  using (user_id = auth.uid());

-- ── token_topup_purchases (Stripe top-up receipts + idempotency) ──────
create table if not exists public.token_topup_purchases (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid references auth.users(id) on delete set null,
  firm_id                    uuid references public.firms(id) on delete set null,
  package_id                 text not null,
  tokens_granted             bigint not null,
  amount_cents               integer not null,
  currency                   text not null default 'USD'::text,
  stripe_payment_intent_id   text unique,
  stripe_checkout_session_id text,
  status                     text not null default 'pending'::text
                               check (status = any (array['pending','succeeded','failed','refunded'])),
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  succeeded_at               timestamptz,
  check (user_id is not null or firm_id is not null)
);
create index if not exists token_topup_purchases_status_idx on public.token_topup_purchases using btree (status, created_at desc);
create index if not exists token_topup_purchases_firm_idx   on public.token_topup_purchases using btree (firm_id, created_at desc) where (firm_id is not null);
create index if not exists token_topup_purchases_user_idx   on public.token_topup_purchases using btree (user_id, created_at desc) where (user_id is not null);

alter table public.token_topup_purchases enable row level security;
-- Reads: the buyer, or an owner/admin of the buying firm. Writes are
-- service-role-only (Stripe webhook / applyTopupPurchase); no write policy.
drop policy if exists "token_topup_self_or_firm_select" on public.token_topup_purchases;
create policy "token_topup_self_or_firm_select" on public.token_topup_purchases
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.firm_members fm
      where fm.firm_id = token_topup_purchases.firm_id
        and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin'])
    )
  );

-- ── Columns added to pre-existing base tables (schema.sql) ────────────
-- Personal token balance + the monthly-grant period stamp the grant
-- helpers dedup on. cases.sandbox is the test-case flag the case-limit
-- count filters on (its absence made that block fail open).
alter table public.profiles add column if not exists token_balance          integer not null default 0;
alter table public.profiles add column if not exists token_quota_period_end timestamptz;
alter table public.cases    add column if not exists sandbox                 boolean not null default false;

commit;
