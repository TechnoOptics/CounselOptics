-- Scope the `staff` firm role out of matter and document reads.
--
-- ============================ NOT APPLIED ================================
-- This migration is deliberately UNAPPLIED in production as of 2026-07-31.
-- Tightening SELECT on a live legal product can lock real users out of
-- their own matters, so a human has to decide when it lands and who it
-- affects. Do not run it as part of a routine deploy without reading the
-- "Who loses access" section below and checking the live membership counts.
-- =========================================================================
--
-- The problem it fixes (docs/audit/UX_AUDIT_COUNSEL.md, finding B3):
-- lib/firm-types.ts describes `staff` to a firm owner, in writing, at the
-- moment they send the invitation, as
--
--   "Read-only access to non-privileged surfaces. Useful for receptionists
--    or billing staff."
--
-- The live policies carry no role filter at all, so a member invited as
-- `staff` reads every matter in the firm at /counsel/cases and every
-- document at /counsel/documents. In a law firm that is a confidentiality
-- and ethical-screen failure, and the product promised the opposite.
--
-- The fix keeps both policies exactly as they are for every other role and
-- only removes `staff` from the membership predicate. Write policies
-- already exclude `staff` (cases_firm_member_update and
-- firm_documents_member_insert/update are limited to owner, admin,
-- attorney, paralegal), so this brings reads in line with writes.
--
-- Who loses access when this is applied:
--   * Firm members whose role is exactly 'staff'. They stop seeing firm
--     matters in /counsel/cases and firm documents in /counsel/documents,
--     including matters they may currently be using to do reception or
--     billing work. Their own consumer cases are unaffected: the separate
--     cases_select_own_or_collaborator policy still applies, so a staff
--     member who is the owner of a case, or a named collaborator on one,
--     keeps that access.
--   * Nobody else. owner, admin, attorney and paralegal are untouched,
--     as are outside co-counsel guests (they reach matters through
--     case_collaborators, not firm_members).
--
-- As of 2026-07-31 the live firm_members table holds 3 owners and 1 admin
-- and NO staff rows at all, so applying this today would remove access from
-- nobody. That will not stay true once firms start inviting reception and
-- billing people, which is exactly the moment the current policy starts
-- leaking. Re-run the count below immediately before applying.
--
-- Before applying, count who is affected:
--   select f.name, count(*) from firm_members m
--     join firms f on f.id = m.firm_id
--    where m.role = 'staff' group by f.name order by 2 desc;
--
-- If a firm is genuinely using `staff` for people who need matter access,
-- the alternative decision is to change the role description instead of the
-- policy, or to add a per-matter grant for those individuals. Do not ship
-- the current combination of a read-only promise and firm-wide read.
--
-- Remember to regenerate supabase/schema-fingerprint.sha256 after applying.

begin;

drop policy if exists cases_firm_member_select on public.cases;

create policy cases_firm_member_select on public.cases
  for select
  to authenticated
  using (
    firm_id is not null
    and exists (
      select 1
        from public.firm_members me
       where me.firm_id = cases.firm_id
         and me.user_id = auth.uid()
         and me.role in ('owner', 'admin', 'attorney', 'paralegal')
    )
  );

drop policy if exists firm_documents_member_select on public.firm_documents;

create policy firm_documents_member_select on public.firm_documents
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.firm_members me
       where me.firm_id = firm_documents.firm_id
         and me.user_id = auth.uid()
         and me.role in ('owner', 'admin', 'attorney', 'paralegal')
    )
  );

commit;
