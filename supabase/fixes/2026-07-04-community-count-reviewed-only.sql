-- 2026-07-04: Public community counts should reflect only public-safe
-- submissions, not every raw insert.
--
-- Audit finding: bump_community_case_counts incremented letter_count on
-- ANY witness_submissions insert, but every letter_of_support lands as
-- 'pending_review' (the interim pre-AV safeguard) and is only public once
-- the organizer marks it 'reviewed'. So the public rally page advertised
-- unreviewed - potentially spam/impersonation - letters in its "N letters
-- of support" count. It also never decremented when a letter was flagged
-- or purged (the old trigger only handled INSERT/DELETE, not status
-- UPDATEs).
--
-- Fix: recompute both counts from the actual countable rows on every
-- INSERT / UPDATE / DELETE. Recomputing (vs. increment/decrement) is
-- immune to status-transition bugs, and the per-case row set is small +
-- indexed on community_case_id, so it's cheap. Countable = the states a
-- visitor is allowed to see:
--   * letters : 'reviewed' only (organizer-approved)
--   * evidence: 'received' or 'reviewed' (excludes flagged/pending_purge/purged)

create or replace function public.bump_community_case_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cc_id uuid := coalesce(new.community_case_id, old.community_case_id);
begin
  if cc_id is null then
    return coalesce(new, old);
  end if;
  update public.community_cases c set
    letter_count = (
      select count(*) from public.witness_submissions w
      where w.community_case_id = cc_id
        and w.kind = 'letter_of_support'
        and w.status = 'reviewed'
    ),
    evidence_count = (
      select count(*) from public.witness_submissions w
      where w.community_case_id = cc_id
        and w.kind <> 'letter_of_support'
        and w.status in ('received', 'reviewed')
    )
  where c.id = cc_id;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.bump_community_case_counts() from public, anon, authenticated;

-- Re-create the trigger to also fire on UPDATE (status transitions), not
-- just INSERT/DELETE.
drop trigger if exists witness_submissions_bump_counts on public.witness_submissions;
create trigger witness_submissions_bump_counts
  after insert or update or delete on public.witness_submissions
  for each row execute function public.bump_community_case_counts();

-- One-time backfill: correct every existing community_cases row to the new
-- definition (previously-inflated pending_review letters are now excluded).
update public.community_cases c set
  letter_count = (
    select count(*) from public.witness_submissions w
    where w.community_case_id = c.id
      and w.kind = 'letter_of_support'
      and w.status = 'reviewed'
  ),
  evidence_count = (
    select count(*) from public.witness_submissions w
    where w.community_case_id = c.id
      and w.kind <> 'letter_of_support'
      and w.status in ('received', 'reviewed')
  );
