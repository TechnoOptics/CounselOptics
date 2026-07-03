-- 2026-07-03: atomic token-balance debits.
--
-- lib/token-economy.ts's debitTokens() previously did SELECT balance,
-- subtract in JS, then UPDATE - two round trips with no row lock between
-- them. Two concurrent Bella turns for the same user (or the same firm
-- pool) could both read the same starting balance and both succeed,
-- letting the balance go negative in effect (each debit floors at 0
-- independently, so the second debit's floor computation is based on a
-- stale pre-decrement number). These two functions make each debit a
-- single atomic statement: the floor-at-zero and the write happen in the
-- same UPDATE, so a concurrent debit against the same row always sees
-- the other's result, never a stale read.

-- Each returns the amount actually taken from this pool (capped at
-- whatever was left) alongside the resulting balance, so the caller's
-- firm-pool-then-personal-balance waterfall (lib/token-economy.ts) can
-- compute the correct remainder to charge the next pool - the atomic
-- UPDATE is the only place that knows the true pre-debit balance.
create or replace function public.debit_firm_token_pool(
  p_firm_id uuid,
  p_amount int
) returns table(new_balance int, amount_debited int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before int;
  v_after int;
  v_debited int;
begin
  select coalesce(token_pool_balance, 0) into v_before
    from public.firms where id = p_firm_id for update;
  if v_before is null then
    return query select 0, 0;
    return;
  end if;
  v_debited := least(v_before, greatest(p_amount, 0));
  v_after := v_before - v_debited;
  update public.firms
    set token_pool_balance = v_after, updated_at = now()
    where id = p_firm_id;
  return query select v_after, v_debited;
end;
$$;

create or replace function public.debit_user_token_balance(
  p_user_id uuid,
  p_amount int
) returns table(new_balance int, amount_debited int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before int;
  v_after int;
  v_debited int;
begin
  select coalesce(token_balance, 0) into v_before
    from public.profiles where id = p_user_id for update;
  if v_before is null then
    return query select 0, 0;
    return;
  end if;
  v_debited := least(v_before, greatest(p_amount, 0));
  v_after := v_before - v_debited;
  update public.profiles
    set token_balance = v_after, updated_at = now()
    where id = p_user_id;
  return query select v_after, v_debited;
end;
$$;

-- Same posture as check_rate_limit: only the service-role admin client
-- calls these, never anon/authenticated directly.
revoke all on function public.debit_firm_token_pool(uuid, int) from public, anon, authenticated;
grant execute on function public.debit_firm_token_pool(uuid, int) to service_role;
revoke all on function public.debit_user_token_balance(uuid, int) from public, anon, authenticated;
grant execute on function public.debit_user_token_balance(uuid, int) to service_role;
