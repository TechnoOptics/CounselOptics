-- 2026-05-02: fix infinite-recursion in firm_members RLS.
--
-- Symptom: every authenticated SELECT on `cases` errored with
--   "infinite recursion detected in policy for relation 'firm_members'"
-- because cases.cases_firm_member_select queries firm_members, and every
-- firm_members policy queried firm_members from inside its own
-- USING / WITH CHECK clause. Postgres re-applies RLS to the subquery,
-- which re-fires the same policy → infinite loop.
--
-- The user-visible fallout was the SETUP REQUIRED screen on /cases
-- (listCases() throws → page renders <SetupNeeded/>).
--
-- Fix: SECURITY DEFINER helpers that read firm_members WITHOUT going
-- through RLS, then rebuild the policies on top of the helpers. Same
-- access semantics, no recursion.
--
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION public.is_firm_member(p_firm_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.firm_members
    WHERE firm_id = p_firm_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_firm_member_with_role(
  p_firm_id uuid,
  p_user_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.firm_members
    WHERE firm_id = p_firm_id
      AND user_id = p_user_id
      AND role = ANY(p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.is_firm_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_firm_member_with_role(uuid, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_firm_member(uuid, uuid)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_firm_member_with_role(uuid, uuid, text[])
  TO authenticated, anon, service_role;

DROP POLICY IF EXISTS firm_members_visible_to_firm ON public.firm_members;
DROP POLICY IF EXISTS firm_members_owner_admin_update ON public.firm_members;
DROP POLICY IF EXISTS firm_members_self_or_admin_delete ON public.firm_members;
DROP POLICY IF EXISTS firm_members_self_or_no_members ON public.firm_members;

-- SELECT: any member of the same firm can see the row.
CREATE POLICY firm_members_visible_to_firm
  ON public.firm_members
  FOR SELECT
  TO authenticated
  USING (public.is_firm_member(firm_id, auth.uid()));

-- UPDATE: owner/admin only.
CREATE POLICY firm_members_owner_admin_update
  ON public.firm_members
  FOR UPDATE
  TO authenticated
  USING (
    public.is_firm_member_with_role(firm_id, auth.uid(), ARRAY['owner','admin'])
  );

-- DELETE: yourself, or owner/admin removing you.
CREATE POLICY firm_members_self_or_admin_delete
  ON public.firm_members
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_firm_member_with_role(firm_id, auth.uid(), ARRAY['owner','admin'])
  );

-- INSERT: only insert yourself, AND either you're the firm owner (boot-strap)
-- or an existing owner/admin (covered by the helper, no self-recursion).
CREATE POLICY firm_members_self_or_no_members
  ON public.firm_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      role = 'owner'
      OR public.is_firm_member_with_role(firm_id, auth.uid(), ARRAY['owner','admin'])
    )
  );
