-- Atomic increment of a signature's access-code attempt counter.
--
-- verifyAccessCodeAction previously read access_attempts, then wrote
-- attempts + 1 as a separate UPDATE. Concurrent wrong guesses all read
-- the same starting value and all write n+1, so K parallel guesses
-- advanced the counter by ~1 instead of K - letting an attacker outrun
-- the MAX_ACCESS_ATTEMPTS lockout. (Audit 2026-07-03, correctness M5.)
--
-- This does the increment in a single statement and returns the NEW
-- value, so the lockout is gated on a count that can't be raced. The
-- caller still checks the returned value against the max. SECURITY
-- DEFINER because the sign flow is unauthenticated (service-role only);
-- exposed to service_role, not anon/authenticated.

create or replace function public.bump_signature_access_attempt(p_id uuid)
returns integer
language plpgsql security definer set search_path = 'public'
as $$
declare v_next integer;
begin
  update public.firm_signatures
    set access_attempts = coalesce(access_attempts, 0) + 1
    where id = p_id
    returning access_attempts into v_next;
  return coalesce(v_next, 0);
end;
$$;

revoke all on function public.bump_signature_access_attempt(uuid) from public, anon, authenticated;
grant execute on function public.bump_signature_access_attempt(uuid) to service_role;
