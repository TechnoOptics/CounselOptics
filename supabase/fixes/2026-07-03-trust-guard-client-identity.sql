-- SECURITY/CORRECTNESS FIX (IOLTA): negative-balance guard keyed on
-- free-text label instead of client identity.
--
-- post_trust_transaction computed the client's current balance with
--   ... where account_id = p_account_id and client_label = p_client_label
-- client_label is operator-typed free text. So "Acme Corp" and
-- "Acme  Corp" (or a casing/whitespace typo) are DIFFERENT ledgers:
-- money deposited under one spelling doesn't count toward the floor
-- check for a disbursement under another, letting a real client
-- sub-ledger go negative while each string stays >= 0. IOLTA requires
-- that no client sub-account ever goes negative.
--
-- Fix: key the balance on the client's IDENTITY. When the transaction
-- carries a client_user_id, aggregate over that user's rows (label
-- typos become irrelevant); otherwise fall back to a NORMALIZED label
-- (trimmed + case-folded) among the rows that also have no user id, so
-- label-only clients are still grouped correctly.
--
-- Only the balance-check aggregation changes; the sign convention,
-- advisory lock, authorization, and insert are identical to
-- 2026-07-03-atomic-trust-post.sql. Reversible: re-apply that file.

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
  -- affected client's current balance within this account, keyed on
  -- client IDENTITY (user id when present, else normalized label).
  if v_sign < 0 then
    select coalesce(sum(
      case when kind in ('deposit', 'refund', 'interest')
           then amount_cents else -amount_cents end
    ), 0)
    into v_current
    from firm_trust_transactions
    where account_id = p_account_id
      and case
            when p_client_user_id is not null
              then client_user_id = p_client_user_id
            else client_user_id is null
              and lower(btrim(coalesce(client_label, '')))
                = lower(btrim(coalesce(p_client_label, '')))
          end;

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
