-- 2026-08-12: give firm_webhook_configs a database-side gate.
--
-- ============================ NOT APPLIED ================================
-- This file has NOT been run against any database. Applying it, and then
-- regenerating supabase/schema-fingerprint.sha256, are the owner's steps.
-- The fingerprint now covers function EXECUTE grants and table and column
-- grants as well as structure, so it will change even if only the grants
-- below take effect.
--
-- Read the "before applying" section at the bottom FIRST. This file makes a
-- claim about the live database that could not be checked from source, and if
-- that claim is wrong in one direction it takes the firm settings page down.
-- =========================================================================
--
-- WHAT THIS IS FOR.
--
-- `firm_webhook_configs` appears exactly once in this repository, in
-- lib/firm-actions.ts. There is no CREATE TABLE for it, no policy, no grant,
-- and no earlier fix file: the table was created out of band. So an auditor
-- reading this codebase cannot establish whether RLS is even enabled on it,
-- let alone what it allows, and the four server actions that read and write it
-- were until now gated on `requireUser()` alone. Whatever the live database
-- turns out to say, a table holding outbound egress credentials should not be
-- the one table whose rules exist nowhere in version control.
--
-- WHY THE ROWS MATTER. Each row is an outbound channel for an organization's
-- matter-room chat: fanoutWebhooks reads the table with the service-role
-- client on every message send and POSTs a preview of the message body to
-- whatever `url` the row carries. A planted row redirects privileged
-- conversation to an arbitrary endpoint. And `url` is itself a bearer
-- credential for Slack or Microsoft Teams, so being able to SELECT the table
-- is credential disclosure, not metadata disclosure. Both directions have to
-- be closed.
--
-- The code gate landed first and does not depend on this file. These policies
-- are the second line, and they name exactly the same set the actions do
-- (owner, admin), so the two cannot disagree.
--
-- WHO LOSES ACCESS WHEN THIS IS APPLIED.
--   * Nobody, if the live table already restricts to firm owners and admins,
--     which is the likely case given the settings page has only ever been
--     reachable by them.
--   * If the live table is currently wide open to `authenticated`, then any
--     firm member whose role is attorney, paralegal or staff stops being able
--     to read or change webhook rows directly. None of them had a way to do
--     so through the product: app/counsel/settings/page.tsx redirects every
--     role but owner and admin, and as of this file the server actions refuse
--     them too.
--   * The service role is unaffected. RLS does not apply to it, which is what
--     keeps fanoutWebhooks working.

begin;

alter table public.firm_webhook_configs enable row level security;

drop policy if exists firm_webhook_configs_admin_select on public.firm_webhook_configs;
create policy firm_webhook_configs_admin_select
  on public.firm_webhook_configs
  for select
  to authenticated
  using (
    private.is_firm_member_with_role(
      firm_id, auth.uid(), array['owner', 'admin']
    )
  );

drop policy if exists firm_webhook_configs_admin_insert on public.firm_webhook_configs;
create policy firm_webhook_configs_admin_insert
  on public.firm_webhook_configs
  for insert
  to authenticated
  with check (
    private.is_firm_member_with_role(
      firm_id, auth.uid(), array['owner', 'admin']
    )
  );

-- USING and WITH CHECK both, and both naming the row's own firm_id. USING
-- alone would let an administrator of firm A take a row they can see and move
-- it onto firm B by updating firm_id, which is the same cross-tenant write
-- from the other end.
drop policy if exists firm_webhook_configs_admin_update on public.firm_webhook_configs;
create policy firm_webhook_configs_admin_update
  on public.firm_webhook_configs
  for update
  to authenticated
  using (
    private.is_firm_member_with_role(
      firm_id, auth.uid(), array['owner', 'admin']
    )
  )
  with check (
    private.is_firm_member_with_role(
      firm_id, auth.uid(), array['owner', 'admin']
    )
  );

drop policy if exists firm_webhook_configs_admin_delete on public.firm_webhook_configs;
create policy firm_webhook_configs_admin_delete
  on public.firm_webhook_configs
  for delete
  to authenticated
  using (
    private.is_firm_member_with_role(
      firm_id, auth.uid(), array['owner', 'admin']
    )
  );

commit;

-- BEFORE APPLYING.
--
-- 1. Confirm the helper is reachable from a policy on this table. It lives in
--    the private schema (supabase/fixes/2026-06-27-move-rls-helpers-to-private
--    -schema.sql) and is used by policies elsewhere, so it should be, but a
--    policy that cannot call its predicate fails closed and locks owners out:
--
--      select p.proname, n.nspname
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where p.proname = 'is_firm_member_with_role';
--
-- 2. Read what is there now, so this file stops guessing:
--
--      select relrowsecurity, relforcerowsecurity
--        from pg_class where oid = 'public.firm_webhook_configs'::regclass;
--      select policyname, cmd, qual, with_check
--        from pg_policies
--       where schemaname = 'public' and tablename = 'firm_webhook_configs';
--
--    If policies already exist under different names, this file's drops will
--    not remove them and the loosest one still wins. Reconcile by hand rather
--    than assuming these four are now the whole story.
--
-- 3. Count who is affected, as 20260731_staff_role_read_scope.sql instructs
--    for any tightening on a live legal product:
--
--      select f.name, m.role, count(*)
--        from public.firm_webhook_configs w
--        join public.firms f on f.id = w.firm_id
--        join public.firm_members m on m.firm_id = w.firm_id
--       where m.role not in ('owner', 'admin')
--       group by f.name, m.role order by 3 desc;
--
-- 4. Verify afterwards that an owner can still list and toggle a webhook from
--    /counsel/settings, and that chat fan-out still fires. The fan-out runs as
--    the service role and is not subject to these policies, but that is a
--    claim worth confirming once rather than assuming forever.
--
-- 5. Regenerate supabase/schema-fingerprint.sha256.
