-- Bank-statement reconciliation for trust accounts.
--
-- A reconciliation records, for one statement period: the bank's
-- ending balance (entered by the operator), the firm's book balance
-- (sum of the whole ledger), and the reconciled balance (sum of the
-- transactions that have cleared the bank). It balances when the bank
-- ending balance equals the reconciled balance. Outstanding items are
-- the difference between the book balance and the reconciled balance.
--
-- Note on "three-way": the general ledger and the per-client
-- sub-ledgers are both derived from firm_trust_transactions, so they
-- are equal by construction and cannot drift. The meaningful
-- reconciliation is therefore bank-vs-ledger; the client-ledger
-- integrity (no negative client balance) is surfaced separately in
-- the UI.

create table if not exists firm_trust_reconciliations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  account_id uuid not null references firm_trust_accounts(id) on delete cascade,
  statement_date date not null,
  bank_balance_cents bigint not null,
  book_balance_cents bigint not null,
  reconciled_balance_cents bigint not null,
  difference_cents bigint not null,
  status text not null check (status = any (array['balanced','unbalanced'])),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists firm_trust_reconciliations_account_idx
  on firm_trust_reconciliations (account_id, statement_date desc);

alter table firm_trust_reconciliations enable row level security;

-- Read-only for firm members; created exclusively through the RPC
-- below (SECURITY DEFINER), so no direct INSERT/UPDATE/DELETE policy.
drop policy if exists firm_trust_reconciliations_select on firm_trust_reconciliations;
create policy firm_trust_reconciliations_select
  on firm_trust_reconciliations for select to authenticated
  using (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_trust_reconciliations.firm_id
        and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney','paralegal'])
    )
  );

-- Link a cleared transaction back to the reconciliation that cleared
-- it (alongside the existing reconciled_at / bank_statement_date).
alter table firm_trust_transactions
  add column if not exists reconciliation_id uuid
  references firm_trust_reconciliations(id) on delete set null;

-- Atomically record a reconciliation and stamp the cleared
-- transactions. SECURITY DEFINER because the ledger is otherwise
-- append-only (members have no UPDATE) - but setting reconciliation
-- metadata (reconciled_at, bank_statement_date, reconciliation_id)
-- never changes a transaction's financial content, so the ledger's
-- immutability guarantee is preserved.
create or replace function public.create_trust_reconciliation(
  p_firm_id uuid,
  p_account_id uuid,
  p_statement_date date,
  p_bank_balance_cents bigint,
  p_transaction_ids uuid[],
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_new_id uuid := gen_random_uuid();
  v_book bigint;
  v_reconciled bigint;
  v_diff bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_statement_date is null then
    raise exception 'statement date is required' using errcode = '22004';
  end if;
  if p_bank_balance_cents is null then
    raise exception 'bank balance is required' using errcode = '22004';
  end if;

  select role into v_role
  from firm_members
  where firm_id = p_firm_id and user_id = v_uid;
  if v_role is null then
    raise exception 'not a member of this firm' using errcode = '42501';
  end if;
  if v_role not in ('owner','admin','attorney','paralegal') then
    raise exception 'role cannot reconcile trust accounts' using errcode = '42501';
  end if;

  if not exists (
    select 1 from firm_trust_accounts
    where id = p_account_id and firm_id = p_firm_id
  ) then
    raise exception 'trust account not found for firm' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 0));

  -- Book balance: the whole ledger for this account.
  select coalesce(sum(
    case when kind in ('deposit','refund','interest')
         then amount_cents else -amount_cents end
  ), 0)
  into v_book
  from firm_trust_transactions
  where account_id = p_account_id;

  -- Reconciled balance AFTER this run: everything already cleared,
  -- plus the newly-checked items. Computed before the stamp so the
  -- reconciliation row can be inserted first (the transactions'
  -- reconciliation_id FK references it).
  select coalesce(sum(
    case when kind in ('deposit','refund','interest')
         then amount_cents else -amount_cents end
  ), 0)
  into v_reconciled
  from firm_trust_transactions
  where account_id = p_account_id
    and (reconciled_at is not null or id = any (p_transaction_ids));

  v_diff := p_bank_balance_cents - v_reconciled;

  insert into firm_trust_reconciliations (
    id, firm_id, account_id, statement_date, bank_balance_cents,
    book_balance_cents, reconciled_balance_cents, difference_cents,
    status, note, created_by
  ) values (
    v_new_id, p_firm_id, p_account_id, p_statement_date, p_bank_balance_cents,
    v_book, v_reconciled, v_diff,
    case when v_diff = 0 then 'balanced' else 'unbalanced' end,
    nullif(btrim(coalesce(p_note, '')), ''), v_uid
  );

  -- Now stamp the newly-cleared transactions (only this account's,
  -- only ones not already reconciled).
  update firm_trust_transactions
  set reconciled_at = now(),
      bank_statement_date = p_statement_date,
      reconciliation_id = v_new_id
  where account_id = p_account_id
    and reconciled_at is null
    and id = any (p_transaction_ids);

  return v_new_id;
end;
$$;

revoke all on function public.create_trust_reconciliation(
  uuid, uuid, date, bigint, uuid[], text
) from public, anon;
grant execute on function public.create_trust_reconciliation(
  uuid, uuid, date, bigint, uuid[], text
) to authenticated;
