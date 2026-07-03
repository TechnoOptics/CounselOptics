-- Make an invoiced time entry immutable at the RLS layer.
--
-- Before: firm_time_entries_self_write (FOR ALL) let a member edit or
-- delete any of their own entries, including one already stamped with
-- invoice_id and sitting on a sent invoice - silently changing that
-- invoice's supporting record with no audit trail (enterprise audit,
-- billing Finding 1).
--
-- After: the USING clause additionally requires invoice_id IS NULL, so
-- an entry can only be UPDATEd/DELETEd while it is NOT yet on an
-- invoice. The WITH CHECK stays unconstrained on invoice_id, so
-- buildDraftInvoiceAction's stamp (invoice_id null -> set) still works:
-- the old row is null (passes USING), the new row has invoice_id set
-- (WITH CHECK doesn't reference it). Normal timer edits (stop timer,
-- sync durations) also happen only while invoice_id is null, so they
-- are unaffected. No code path ever un-stamps an entry, so nothing
-- legitimately needs to write an already-invoiced row.
--
-- Applied 2026-07-03 while firm_time_entries was empty (zero rows).
-- This is also folded into 2026-07-03-billing-schema.sql so that file
-- reflects the current policy; kept as its own migration for history.

drop policy if exists firm_time_entries_self_write on firm_time_entries;
create policy firm_time_entries_self_write
  on firm_time_entries for all to authenticated
  using (
    user_id = auth.uid()
    and invoice_id is null
    and exists (
      select 1 from firm_members
      where firm_members.firm_id = firm_time_entries.firm_id
        and firm_members.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from firm_members
      where firm_members.firm_id = firm_time_entries.firm_id
        and firm_members.user_id = auth.uid()
    )
  );
