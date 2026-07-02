-- 2026-07-02: actual enforcement of the "ID photos are kept until the
-- organizer/attorney manually closes the case" retention decision.
-- Closing a Community Case previously only flipped community_cases.status
-- - it never touched witness_submissions, so ID/signature images sat in
-- storage indefinitely after close. This adds the timestamp the purge
-- cron (lib/community-retention.ts) gates on, kept separate from
-- `status` so "pending_purge" (a display-only label) and the actual
-- schedule can't drift, and so a reopen within the grace window can
-- cleanly cancel the purge by nulling this column without having to
-- remember what status to revert to.
alter table public.witness_submissions
  add column if not exists purge_scheduled_at timestamptz;
alter table public.witness_submissions
  add column if not exists purged_at timestamptz;
