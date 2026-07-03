-- Trust-accounting schema, brought into source control.
--
-- The firm_trust_accounts and firm_trust_transactions tables existed
-- only in the live Supabase project with no tracked DDL, so RLS and
-- constraints on an IOLTA (client-money) surface were invisible to
-- code review. This file documents them and is idempotent
-- (CREATE ... IF NOT EXISTS), so it can be applied to a fresh branch
-- without disturbing the existing production tables.
--
-- Companion migrations already applied:
--   2026-07-03-atomic-trust-post.sql        (post_trust_transaction RPC)
--   2026-07-03-trust-ledger-append-only.sql (SELECT-only ledger policy)
-- Both are folded into the policy/RPC sections below so this one file
-- reflects the current state of the surface.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists firm_trust_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  name text not null,
  bank_name text,
  account_number_masked text,
  routing_number_masked text,
  is_iolta boolean default true,
  state text,
  bar_foundation text,
  created_at timestamptz not null default now()
);

create table if not exists firm_trust_transactions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  account_id uuid not null references firm_trust_accounts(id) on delete cascade,
  case_id uuid references cases(id) on delete set null,
  client_user_id uuid references auth.users(id) on delete set null,
  client_label text not null,
  kind text not null check (kind = any (array[
    'deposit','earned_fee_transfer','disbursement','refund',
    'bank_fee','interest','correction'
  ])),
  amount_cents integer not null,
  description text,
  reference text,
  reconciled_at timestamptz,
  bank_statement_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Amounts are always a positive whole number of cents; sign is derived
-- from `kind` at read time (lib/trust-accounting-queries.ts signedAmount).
alter table firm_trust_transactions
  drop constraint if exists firm_trust_transactions_amount_positive;
alter table firm_trust_transactions
  add constraint firm_trust_transactions_amount_positive
  check (amount_cents > 0);

create index if not exists firm_trust_transactions_account_idx
  on firm_trust_transactions (account_id);
create index if not exists firm_trust_transactions_firm_idx
  on firm_trust_transactions (firm_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table firm_trust_accounts enable row level security;
alter table firm_trust_transactions enable row level security;

-- Accounts: posting-role members manage them (created client-side from
-- the trust settings form, so INSERT/UPDATE are needed here).
drop policy if exists firm_trust_accounts_member on firm_trust_accounts;
create policy firm_trust_accounts_member
  on firm_trust_accounts
  for all
  to authenticated
  using (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_trust_accounts.firm_id
        and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney'])
    )
  )
  with check (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_trust_accounts.firm_id
        and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney'])
    )
  );

-- Transactions: append-only. Members may only SELECT; every write goes
-- through post_trust_transaction (SECURITY DEFINER), which enforces
-- authorization and the negative-balance guard. No UPDATE/DELETE path,
-- so a posted entry is immutable at the RLS layer.
drop policy if exists firm_trust_transactions_member on firm_trust_transactions;
drop policy if exists firm_trust_transactions_select on firm_trust_transactions;
create policy firm_trust_transactions_select
  on firm_trust_transactions
  for select
  to authenticated
  using (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_trust_transactions.firm_id
        and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney','paralegal'])
    )
  );
