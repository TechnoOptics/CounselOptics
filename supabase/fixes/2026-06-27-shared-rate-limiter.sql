-- 2026-06-27: shared (cross-instance) rate limiter.
--
-- The previous limiters were in-memory (per serverless instance), so they
-- didn't actually cap a determined caller. This table + atomic function give
-- a shared counter. Read by lib/rate-limit.ts via the service_role client.
create table if not exists public.rate_limits (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
-- No policies on purpose: only the SECURITY DEFINER function (runs as
-- owner) and the service_role client ever touch this table.

create or replace function public.check_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count int;
begin
  insert into public.rate_limits(key, count, window_start)
    values (p_key, 1, v_now)
  on conflict (key) do update set
    count = case
      when public.rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
      then 1 else public.rate_limits.count + 1 end,
    window_start = case
      when public.rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
      then v_now else public.rate_limits.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- Only the service_role (server-side admin client) may call it; never anon/authenticated.
revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
