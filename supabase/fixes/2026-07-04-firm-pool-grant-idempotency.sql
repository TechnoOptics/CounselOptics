-- Concurrency-safe firm-pool token grant. Sibling of token_monthly_grants
-- (2026-07-04-monthly-grant-idempotency.sql), for the multi-seat path.
--
-- grantFirmPoolTokens() (lib/token-economy.ts) gated only on a read of
-- firms.token_pool_period_end before crediting the pool, so two deliveries for
-- a NEW period (Stripe at-least-once retry, or a webhook racing a manual
-- re-sync) could both pass the check and both credit seats * FIRM_POOL_GRANT,
-- inflating the shared pool.
--
-- Same insert-first-claim idempotency: the FIRST delivery wins a
-- UNIQUE(firm_id, period_end) insert; a concurrent duplicate loses with 23505
-- and becomes a no-op. period_end is TEXT so the unique key is the exact string
-- the helper keys on, with no timestamptz normalization. The existing
-- firms.token_pool_period_end read-check stays in the helper as a fast path so
-- firms already granted for the current period before this table existed are
-- not re-granted on the first post-deploy delivery. Idempotent: safe to re-run.

create table if not exists public.token_firm_pool_grants (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  period_end  text not null,
  tier        text not null,
  seats       integer not null,
  tokens      bigint not null,
  granted_at  timestamptz not null default now(),
  unique (firm_id, period_end)
);
create index if not exists token_firm_pool_grants_firm_idx
  on public.token_firm_pool_grants using btree (firm_id, granted_at desc);

alter table public.token_firm_pool_grants enable row level security;
-- Reads: members of the firm. Writes are service-role-only (grantFirmPoolTokens
-- via the admin client); no write policy, mirroring token_topup_purchases and
-- token_monthly_grants.
drop policy if exists "token_firm_pool_grants_member_select" on public.token_firm_pool_grants;
create policy "token_firm_pool_grants_member_select" on public.token_firm_pool_grants
  for select to authenticated
  using (
    exists (
      select 1 from public.firm_members fm
      where fm.firm_id = token_firm_pool_grants.firm_id
        and fm.user_id = auth.uid()
    )
  );
