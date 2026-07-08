-- 2026-07-07: first-class responsible-attorney assignment on matters.
--
-- Until now `public.cases` carried no explicit assignee. The counsel
-- dashboard's "Assigned to me" lane inferred ownership indirectly
-- (firm_clients.primary_attorney_id -> the client's user -> cases.user_id),
-- which breaks the moment a matter isn't tied to a client row and can't
-- express "this attorney is responsible for this matter" at all. This
-- adds a real, nullable assignee column so caseload management has a
-- single source of truth on the matter itself.
--
-- `assigned_to` is the firm member (auth.users) responsible for the
-- matter. NULL = unassigned. ON DELETE SET NULL so removing a user from
-- Supabase Auth doesn't cascade-delete their matters - the matter simply
-- falls back to unassigned and can be re-routed.
--
-- RLS: unchanged / still firm-scoped. Adding a column inherits the
-- existing row-level policies on public.cases, so nothing here widens who
-- can see a matter. Assignment WRITES go through the service-role
-- (setCaseAssigneeAction), which verifies firm membership and that the
-- target assignee is a member of the same firm before touching the row -
-- mirroring how every other cross-firm write in this codebase is gated
-- (see lib/import-actions.ts / lib/firm-actions.ts). We intentionally do
-- NOT add a broad firm-member UPDATE policy: Postgres RLS can't restrict
-- an UPDATE to a single column, so a firm-wide UPDATE policy would let any
-- member rewrite every field on the matter, not just its assignee.
--
-- Idempotent. Safe to re-run.

alter table public.cases
  add column if not exists assigned_to uuid
    references auth.users(id) on delete set null;

-- Powers the dashboard "Assigned to me" lane and the cases-list assignee
-- filter: both query by (firm_id, assigned_to). Partial index keeps it
-- lean - the vast majority of historical rows are unassigned.
create index if not exists cases_firm_assigned_to_idx
  on public.cases (firm_id, assigned_to)
  where assigned_to is not null;
