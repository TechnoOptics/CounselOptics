-- 2026-06-26: harden unused SECURITY DEFINER helpers (RPC exposure).
--
-- Remove anon/authenticated RPC exposure from the two SECURITY DEFINER
-- helpers that are NOT referenced by any RLS policy:
--   handle_new_user(): an auth.users trigger (fires regardless of EXECUTE grant)
--   hq_check_rls(text[]): an admin-only diagnostic called via the service_role client
-- The other helpers (is_admin, is_case_owner, is_case_member, can_add_to_case,
-- is_firm_member, is_firm_member_with_role) ARE used in RLS policies, so revoking
-- their EXECUTE would break policy evaluation for authenticated users; they were
-- instead moved to a private schema (see 2026-06-27-move-rls-helpers-to-private-schema).
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hq_check_rls(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hq_check_rls(text[]) TO service_role;
