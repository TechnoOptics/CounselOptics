-- 2026-07-02: soft duplicate/impersonation detection for Community Cases.
--
-- A known scam pattern is cloning a real, sympathetic case under a new
-- organizer account. This does not block creation (false positives from
-- unrelated cases sharing a common name are likely) - it flags a note,
-- visible only to the organizer/attorney of the NEW page, so a human can
-- decide whether it's a coincidence or something to investigate. Never
-- shown publicly.
create extension if not exists pg_trgm;

alter table public.community_cases
  add column if not exists duplicate_warning text;

create index if not exists community_cases_display_name_trgm_idx
  on public.community_cases using gin (display_name gin_trgm_ops);

-- security definer, like get_public_community_case: callable by any
-- authenticated user (via PostgREST RPC from the organizer-creation
-- server action), but only ever returns the case_number/display_name of
-- an existing PUBLISHED-OR-CLOSED case - both of which are already
-- public-safe once that case is published. Never returns anything from a
-- still-draft page, so this can't be used to discover un-launched pages.
create or replace function public.find_similar_community_case(_display_name text)
returns table (case_number text, display_name text, score real)
language sql
security definer
set search_path = public
as $$
  select cc.case_number, cc.display_name, similarity(cc.display_name, _display_name) as score
  from public.community_cases cc
  where cc.status in ('published', 'closed')
    and similarity(cc.display_name, _display_name) > 0.45
  order by score desc
  limit 1;
$$;

revoke all on function public.find_similar_community_case(text) from public;
grant execute on function public.find_similar_community_case(text) to authenticated;
