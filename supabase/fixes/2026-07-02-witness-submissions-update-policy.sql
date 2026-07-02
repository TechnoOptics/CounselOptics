-- 2026-07-02: witness_submissions had a SELECT policy for the case
-- owner/attorney but no UPDATE policy at all - RLS defaults to deny-all
-- for an operation with no matching policy, which would have silently
-- no-op'd the organizer's "mark reviewed" action (Supabase's .update()
-- returns no error when RLS filters out every row, it just affects zero
-- rows). Scoped the same way as the existing SELECT policy.
drop policy if exists "witness_submissions_update_owner_or_attorney" on public.witness_submissions;
create policy "witness_submissions_update_owner_or_attorney"
  on public.witness_submissions for update
  using (private.is_case_owner_or_attorney(case_id))
  with check (private.is_case_owner_or_attorney(case_id));
