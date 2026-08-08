-- UPDATE policies for case_collaborators and exhibits.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-08. Applying this and regenerating
-- supabase/schema-fingerprint.sha256 is the OWNER'S step.
-- =========================================================================
--
-- WHY THESE ARE MISSING. Both tables carry SELECT, INSERT and DELETE policies
-- and no UPDATE policy at all, so RLS denied every update through the
-- user-scoped client. The application did not notice, because PostgREST does
-- not raise an error when zero rows match: updateWitnessStatement and the
-- exhibit writes returned cleanly and their callers then wrote
-- witness_statement_updated and friends into the audit chain. That reporting
-- half is fixed separately in lib/storage.ts; this file is the half that lets
-- the writes actually land.
--
-- Verified against production before writing: pg_policies shows DELETE,
-- INSERT and SELECT on both tables and no UPDATE, and audit_events holds zero
-- witness_statement_updated and zero exhibit rows, so no real data was lost.
-- The paths simply never worked.
--
-- ---------------------------------------------------------------------------
-- THE ESCALATION THIS FILE HAS TO AVOID
-- ---------------------------------------------------------------------------
-- case_collaborators.role is a writable, not-null column, and it is what
-- private.can_add_to_case and private.is_case_member read. A policy that
-- simply says "a collaborator may update their own row" would let any
-- collaborator promote themselves by writing their own role.
--
-- RLS cannot express "these columns may change and those may not": USING sees
-- the old row and WITH CHECK sees the new one, and neither can compare the
-- two. The mechanism that CAN express it is a column-level grant, so that is
-- what this uses. Both roles currently hold a blanket table-level UPDATE
-- grant on all ten columns, which is the thing being narrowed.
--
-- service_role keeps its full grant, so the admin paths that legitimately
-- manage a collaboration are untouched.

begin;

-- ---------------------------------------------------------------------------
-- 1. case_collaborators: a witness may write their own statement, nothing else
-- ---------------------------------------------------------------------------

-- anon has no business updating a collaboration row. RLS already blocks it,
-- because auth.uid() is null for anon and every predicate below fails closed,
-- but a grant that is only masked by a policy is one policy edit away from
-- being real.
revoke update on public.case_collaborators from anon;

-- Narrow authenticated from all ten columns to the two that hold a statement.
-- After this, role, case_id, user_id and email cannot be written by a signed
-- in user through the anon key at all, whatever any policy says.
revoke update on public.case_collaborators from authenticated;
grant update (witness_statement, witness_statement_updated_at)
  on public.case_collaborators to authenticated;

-- The row-level half. The collaborator writes their own statement; the case
-- owner may also correct one on a case they own, which is the same pairing
-- the SELECT policy already uses.
--
-- WITH CHECK repeats the predicate rather than being omitted, so a row cannot
-- be updated INTO a shape the writer would not have been allowed to reach.
-- With the column grant above this is belt and braces, and it stays correct if
-- the grant is ever widened.
do $$ begin
  create policy case_collaborators_update_own_statement
    on public.case_collaborators
    for update
    using (private.is_case_owner(case_id) or (user_id = auth.uid()))
    with check (private.is_case_owner(case_id) or (user_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. exhibits: the uploader or the case owner may edit an exhibit
-- ---------------------------------------------------------------------------
--
-- This mirrors exhibits_delete_uploader_or_owner exactly. Someone who may
-- remove an exhibit outright may certainly relabel it, and the pairing is
-- already the product's answer to "whose exhibit is this".
--
-- WITH CHECK carries the same predicate, which is what stops an exhibit being
-- moved onto a case the writer does not own, or reassigned to another user.
-- Without it, USING would admit the row and any new case_id would be accepted.

revoke update on public.exhibits from anon;

do $$ begin
  create policy exhibits_update_uploader_or_owner
    on public.exhibits
    for update
    using ((auth.uid() = user_id) or private.is_case_owner(case_id))
    with check ((auth.uid() = user_id) or private.is_case_owner(case_id));
exception when duplicate_object then null; end $$;

commit;
