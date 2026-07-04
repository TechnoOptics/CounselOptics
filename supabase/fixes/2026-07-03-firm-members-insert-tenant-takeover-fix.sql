-- SECURITY FIX (Critical): cross-tenant self-promotion to owner.
--
-- The previous INSERT policy on public.firm_members:
--
--   firm_members_self_or_no_members  WITH CHECK (
--     user_id = auth.uid()
--     AND ( role = 'owner'
--        OR private.is_firm_member_with_role(firm_id, auth.uid(),
--                                            array['owner','admin']) ) )
--
-- had an unguarded `role = 'owner'` branch: ANY authenticated user could
-- INSERT (firm_id = <any victim firm>, user_id = self, role = 'owner')
-- and instantly become owner of another tenant. Every firm-scoped RLS
-- policy (documents, invoices, IOLTA trust, messages, PHI) authorizes via
-- firm_members, so this was a full cross-tenant read/write + privilege
-- escalation primitive. The comment claimed a "bootstrap first owner"
-- purpose, but the empty-firm guard was never present.
--
-- The app NEVER uses this user-scoped INSERT path: the only firm_members
-- insert in the codebase is the owner-bootstrap in createFirmAction, which
-- runs through the SERVICE-ROLE admin client (lib/firm-actions.ts:166) and
-- bypasses RLS entirely. So tightening this policy to "an existing
-- owner/admin of THIS firm may add members" (matching the UPDATE and
-- DELETE policies) removes the entire attack surface with zero functional
-- impact on any real flow.
--
-- Reversible: to restore the old behavior, drop this policy and recreate
-- firm_members_self_or_no_members with the WITH CHECK shown above.

drop policy if exists firm_members_self_or_no_members on public.firm_members;

create policy firm_members_owner_admin_insert
  on public.firm_members
  for insert
  to authenticated
  with check (
    private.is_firm_member_with_role(
      firm_id, auth.uid(), array['owner', 'admin']
    )
  );
