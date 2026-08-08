-- Atomic token CREDIT RPCs - the mirror of debit_firm_token_pool /
-- debit_user_token_balance. Needed for refunds: previously there was no
-- way to put tokens back, so a turn that debited the firm pool and then
-- came up short on the personal balance (or an Anthropic call that
-- failed after the pre-call debit) silently kept the user's tokens.
-- (Audit 2026-07-03, correctness H2/H3.)
--
-- Same FOR UPDATE row lock as the debit functions so a concurrent
-- debit/credit on the same row can't lose an update. Crediting a
-- non-existent row is a no-op that returns 0.

create or replace function public.credit_firm_token_pool(
  p_firm_id uuid, p_amount integer
) returns integer
language plpgsql security definer set search_path = 'public'
as $$
declare v_before int; v_after int;
begin
  if p_amount is null or p_amount <= 0 then
    select coalesce(token_pool_balance, 0) into v_before
      from public.firms where id = p_firm_id;
    return coalesce(v_before, 0);
  end if;
  select coalesce(token_pool_balance, 0) into v_before
    from public.firms where id = p_firm_id for update;
  if v_before is null then
    return 0; -- firm not found
  end if;
  v_after := v_before + p_amount;
  update public.firms
    set token_pool_balance = v_after, updated_at = now()
    where id = p_firm_id;
  return v_after;
end;
$$;

create or replace function public.credit_user_token_balance(
  p_user_id uuid, p_amount integer
) returns integer
language plpgsql security definer set search_path = 'public'
as $$
declare v_before int; v_after int;
begin
  if p_amount is null or p_amount <= 0 then
    select coalesce(token_balance, 0) into v_before
      from public.profiles where id = p_user_id;
    return coalesce(v_before, 0);
  end if;
  select coalesce(token_balance, 0) into v_before
    from public.profiles where id = p_user_id for update;
  if v_before is null then
    return 0; -- user not found
  end if;
  v_after := v_before + p_amount;
  update public.profiles
    set token_balance = v_after, updated_at = now()
    where id = p_user_id;
  return v_after;
end;
$$;

-- service_role ONLY, and deliberately so.
--
-- These two are SECURITY DEFINER, so they run past RLS. Granting EXECUTE to
-- `authenticated` made credit_firm_token_pool callable by any signed in user
-- straight over PostgREST, which let them credit a firm's token pool by any
-- amount they liked. Tokens are the paid currency. That was live in
-- production until 2026-08-09; see
-- supabase/migrations/20260809_revoke_credit_firm_token_pool.sql.
--
-- The debit_* siblings in 2026-07-03-atomic-token-debits.sql were always
-- service_role only. These should have matched them from the start.
--
-- Every caller is server side: admin.rpc(...) at lib/token-economy.ts:368
-- and :383. Nothing in the product needs a user to hold this grant, so if a
-- future change appears to need one, the change is wrong.
revoke all on function public.credit_firm_token_pool(uuid, integer) from public, anon, authenticated;
revoke all on function public.credit_user_token_balance(uuid, integer) from public, anon, authenticated;
grant execute on function public.credit_firm_token_pool(uuid, integer) to service_role;
grant execute on function public.credit_user_token_balance(uuid, integer) to service_role;
