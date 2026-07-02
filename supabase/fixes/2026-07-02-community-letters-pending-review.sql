-- 2026-07-02: Letters of Support - interim "pending review" safeguard.
--
-- Letters of Support carry ID front/back photos from anonymous internet
-- submitters. Full malware/AV scanning (the plan's stated hard prerequisite
-- for this slice) isn't wired up yet - no vendor is chosen. Interim
-- mitigation until then: every letter_of_support submission lands in
-- 'pending_review' instead of 'received'. The organizer UI does not offer
-- a one-click "open the file" action for pending_review submissions the
-- way it does for evidence - it shows an explicit warning and requires a
-- deliberate click before rendering/downloading the raw ID image, and a
-- separate "mark reviewed" action to clear the flag. This does not replace
-- AV scanning; it reduces the chance of a passive/automatic render of an
-- unscanned file in the organizer's browser.
alter table public.witness_submissions
  drop constraint if exists witness_submissions_status_check;
alter table public.witness_submissions
  add constraint witness_submissions_status_check
  check (status in ('pending_review', 'received', 'reviewed', 'flagged', 'pending_purge', 'purged'));
