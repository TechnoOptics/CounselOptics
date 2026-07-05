-- 2026-07-04: DB-side trust reconciliation summary (scalability + per-client
-- identity consistency).
--
-- Audit findings:
--   * reconcileTrustAccount / getReconciliationWorkspace loaded a firm
--     account's ENTIRE ledger into the Node process to sum it in JS - it
--     grows unboundedly, so a long-lived IOLTA account eventually OOMs the
--     page render.
--   * reconcileTrustAccount bucketed per-client balances by RAW client_label
--     (operator-typed free text), while the negative-balance guard in
--     post_trust_transaction keys on client IDENTITY (client_user_id, else
--     the normalized label). So the reconciliation report could split one
--     client into several rows (or merge two), diverging from the guard's
--     view of "the client's balance".
--
-- This SECURITY DEFINER function does the aggregation in Postgres and buckets
-- per-client by the SAME identity key the guard uses, so the reconciliation
-- report and the disbursement guard always agree. Read-only; authorization
-- mirrors the guard: caller must be a member of the firm.
--
-- Sign convention is identical to signedAmount()/post_trust_transaction:
--   deposit | refund | interest  -> +amount_cents
--   everything else (incl. correction, earned_fee_transfer, disbursement,
--   bank_fee)                     -> -amount_cents

create or replace function public.get_trust_reconciliation_summary(
  p_firm_id uuid,
  p_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_member boolean;
  v_book bigint;
  v_reconciled bigint;
  v_unrecon integer;
  v_per_client jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Authorization: any member of the firm may view trust reconciliation
  -- (matches the SELECT-side RLS these reads previously went through).
  select exists (
    select 1 from firm_members where firm_id = p_firm_id and user_id = v_uid
  ) into v_is_member;
  if not v_is_member then
    raise exception 'not a member of this firm' using errcode = '42501';
  end if;

  if not exists (
    select 1 from firm_trust_accounts where id = p_account_id and firm_id = p_firm_id
  ) then
    raise exception 'trust account not found for firm' using errcode = '23503';
  end if;

  -- Book balance, reconciled balance, and unreconciled count in one pass.
  select
    coalesce(sum(s.signed), 0),
    coalesce(sum(s.signed) filter (where s.reconciled), 0),
    coalesce(count(*) filter (where not s.reconciled), 0)
  into v_book, v_reconciled, v_unrecon
  from (
    select
      case when kind in ('deposit', 'refund', 'interest')
           then amount_cents else -amount_cents end as signed,
      reconciled_at is not null as reconciled
    from firm_trust_transactions
    where firm_id = p_firm_id and account_id = p_account_id
  ) s;

  -- Per-client balances, bucketed by client IDENTITY (user id when present,
  -- else the normalized label) so they agree with the guard. The display
  -- label is the most recently-used label for that identity.
  select coalesce(
    jsonb_agg(
      jsonb_build_object('clientLabel', g.label, 'balanceCents', g.bal)
      order by g.bal desc
    ),
    '[]'::jsonb
  )
  into v_per_client
  from (
    select
      (array_agg(client_label order by created_at desc nulls last))[1] as label,
      sum(case when kind in ('deposit', 'refund', 'interest')
               then amount_cents else -amount_cents end) as bal
    from firm_trust_transactions
    where firm_id = p_firm_id and account_id = p_account_id
    group by case
               when client_user_id is not null then 'u:' || client_user_id::text
               else 'l:' || lower(btrim(coalesce(client_label, '')))
             end
  ) g;

  return jsonb_build_object(
    'bookBalanceCents', v_book,
    'reconciledBalanceCents', v_reconciled,
    'unreconciledCount', v_unrecon,
    'perClient', v_per_client
  );
end;
$$;

-- Trigger-safe grants: callable only by signed-in users; the function
-- itself enforces firm membership.
revoke execute on function public.get_trust_reconciliation_summary(uuid, uuid) from public, anon;
grant execute on function public.get_trust_reconciliation_summary(uuid, uuid) to authenticated;
