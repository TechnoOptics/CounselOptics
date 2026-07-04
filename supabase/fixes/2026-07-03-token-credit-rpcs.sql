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

revoke all on function public.credit_firm_token_pool(uuid, integer) from public, anon;
revoke all on function public.credit_user_token_balance(uuid, integer) from public, anon;
grant execute on function public.credit_firm_token_pool(uuid, integer) to authenticated, service_role;
grant execute on function public.credit_user_token_balance(uuid, integer) to authenticated, service_role;
