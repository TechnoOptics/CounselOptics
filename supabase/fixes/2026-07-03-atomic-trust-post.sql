-- Atomic trust-transaction posting with a negative-balance guard.
-- Applied to production 2026-07-03 via apply_migration; committed here
-- so the trust-accounting control surface is reviewable in source
-- control (the firm_trust_* tables themselves still need a tracked
-- CREATE TABLE migration - see the enterprise audit's critical items).
--
-- Before this, recordTrustTransactionAction did a bare INSERT with no
-- balance check, so two concurrent disbursements against a low client
-- balance could both succeed and take an IOLTA client ledger negative.
--
-- This SECURITY DEFINER function:
--   1. Re-verifies the caller is a firm_member with a posting role
--      (definer bypasses RLS, so authorization must be explicit here).
--   2. Takes a per-account advisory lock so the read-then-insert is
--      serialized against other posts to the same account.
--   3. Computes the affected client's current signed balance and
--      rejects the insert if this transaction would drive it negative.
--   4. Inserts and returns the new row id.
--
-- Sign convention mirrors lib/trust-accounting-queries.ts signedAmount:
-- deposit / refund / interest increase the balance; everything else
-- (including corrections) decreases it. amount_cents is always > 0.
create or replace function public.post_trust_transaction(
  p_firm_id uuid,
  p_account_id uuid,
  p_case_id uuid,
  p_client_user_id uuid,
  p_client_label text,
  p_kind text,
  p_amount_cents integer,
  p_description text,
  p_reference text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_sign integer;
  v_current bigint;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount must be a positive integer' using errcode = '22003';
  end if;

  -- Authorization: caller must be a posting-role member of this firm.
  select role into v_role
  from firm_members
  where firm_id = p_firm_id and user_id = v_uid;
  if v_role is null then
    raise exception 'not a member of this firm' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'attorney', 'paralegal') then
    raise exception 'role cannot post trust transactions' using errcode = '42501';
  end if;

  -- The account must belong to this firm.
  if not exists (
    select 1 from firm_trust_accounts
    where id = p_account_id and firm_id = p_firm_id
  ) then
    raise exception 'trust account not found for firm' using errcode = '23503';
  end if;

  -- Serialize concurrent posts to the same account so the balance read
  -- below and the insert are effectively atomic.
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 0));

  v_sign := case when p_kind in ('deposit', 'refund', 'interest') then 1 else -1 end;

  -- Only decreasing transactions can breach the floor; check the
  -- affected client's current balance within this account.
  if v_sign < 0 then
    select coalesce(sum(
      case when kind in ('deposit', 'refund', 'interest')
           then amount_cents else -amount_cents end
    ), 0)
    into v_current
    from firm_trust_transactions
    where account_id = p_account_id
      and client_label = p_client_label;

    if v_current - p_amount_cents < 0 then
      raise exception
        'insufficient trust balance: client holds % cents, cannot post % cents',
        v_current, p_amount_cents
        using errcode = '23514';
    end if;
  end if;

  insert into firm_trust_transactions (
    firm_id, account_id, case_id, client_user_id, client_label,
    kind, amount_cents, description, reference, created_by
  ) values (
    p_firm_id, p_account_id, p_case_id, p_client_user_id, p_client_label,
    p_kind, p_amount_cents, p_description, p_reference, v_uid
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.post_trust_transaction(
  uuid, uuid, uuid, uuid, text, text, integer, text, text
) from public, anon;
grant execute on function public.post_trust_transaction(
  uuid, uuid, uuid, uuid, text, text, integer, text, text
) to authenticated;
