-- 2026-06-27: move RLS helper functions out of the public schema.
--
-- Move the 6 SECURITY DEFINER RLS helper functions out of the
-- PostgREST-exposed `public` schema into a private schema so they can
-- no longer be invoked as anon/authenticated RPC endpoints. Policies
-- reference these by OID, which ALTER FUNCTION ... SET SCHEMA preserves,
-- so all 24+ policies keep working. Each function has a pinned
-- search_path=public and fully-qualified table refs, so internals are
-- unaffected. No other function/view references them.
CREATE SCHEMA IF NOT EXISTS private;
ALTER FUNCTION public.is_admin(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_case_owner(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_case_member(uuid) SET SCHEMA private;
ALTER FUNCTION public.can_add_to_case(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_firm_member(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.is_firm_member_with_role(uuid, uuid, text[]) SET SCHEMA private;
