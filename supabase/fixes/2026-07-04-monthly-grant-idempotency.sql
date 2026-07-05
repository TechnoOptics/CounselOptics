-- Concurrency-safe monthly token grant.
--
-- grantTierMonthlyTokens() (lib/token-economy.ts) gated only on a read of
-- profiles.token_quota_period_end before crediting. Two deliveries for a NEW
-- period -- e.g. the RevenueCat webhook and the client /api/iap/sync firing
-- together, or Stripe's at-least-once retry racing the first delivery -- could
-- both read the old period, both pass the check, and both write a grant,
-- inflating the ledger (and, under an interleaved debit, the balance).
--
-- This claim table applies the same insert-first-claim idempotency that
-- token_topup_purchases already uses for top-ups: the FIRST delivery wins a
-- UNIQUE(user_id, period_end) insert; a concurrent duplicate loses with 23505
-- and becomes a no-op. period_end is stored as TEXT so the unique key is the
-- exact string the grant helper keys on (input.periodEnd), with no timestamptz
-- normalization that could let two string forms of the same instant both claim.
--
-- The existing profiles.token_quota_period_end read-check is KEPT in the helper
-- as a fast path so this deploy does not re-grant subscribers who were already
-- granted for the current period before this table existed (they have no claim
-- row yet); the claim insert is added purely as the concurrency gate before the
-- credit. Idempotent: safe to re-run.

create table if not exists public.token_monthly_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  period_end  text not null,
  tier        text not null,
  tokens      bigint not null,
  granted_at  timestamptz not null default now(),
  unique (user_id, period_end)
);
create index if not exists token_monthly_grants_user_idx
  on public.token_monthly_grants using btree (user_id, granted_at desc);

alter table public.token_monthly_grants enable row level security;
-- Reads: the subscriber's own grant history. Writes are service-role-only
-- (grantTierMonthlyTokens via the admin client); no write policy, mirroring
-- token_topup_purchases.
drop policy if exists "token_monthly_grants_self_select" on public.token_monthly_grants;
create policy "token_monthly_grants_self_select" on public.token_monthly_grants
  for select to authenticated
  using (user_id = auth.uid());
