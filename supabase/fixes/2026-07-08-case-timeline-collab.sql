-- 2026-07-08  Case timeline collaboration: section comments + chat
--
-- Two new case-scoped tables that power collaboration on a matter's timeline,
-- shared between the firm-native counsel surface AND the invited external
-- parties on a case (case_collaborators: represented client / co-counsel /
-- contributor / viewer):
--
--   case_section_comments  - threaded comments anchored to a specific section
--                            of the case: an evidence item, a timeline event,
--                            or a calendar day/period.
--   case_chat_messages     - a general case chat plus per-person DM threads.
--
-- Access model. Consumer case members (owner + case_collaborators) reach these
-- through their own authed client, gated by RLS. Firm members are NOT case
-- members of a firm matter, so the firm counsel surface reads/writes through
-- the ADMIN client gated in application code on firm membership + case.firm_id
-- (see lib/case-collab-actions.ts, mirroring lib/firm-timeline-actions.ts).
-- BUT firm members also subscribe to Supabase Realtime with their authed
-- browser client, and Realtime honours RLS - so the SELECT policies below must
-- also admit firm members of the case's firm. private.is_firm_case_member does
-- exactly that.
--
-- Roles that may POST (comment / send chat) mirror private.can_add_to_case:
-- owner, an editor/attorney/represented collaborator, or any firm member.
-- Viewers and witnesses can read but not post.
--
-- RLS helpers live in the PRIVATE schema (2026-06-27-move-rls-helpers-to-
-- private-schema.sql) so they are not exposed as PostgREST RPCs.

-- ── helper: is the caller a firm member of this case's firm? ──────────────
create or replace function private.is_firm_case_member(_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.cases c
    join public.firm_members fm on fm.firm_id = c.firm_id
    where c.id = _case_id
      and c.firm_id is not null
      and fm.user_id = auth.uid()
  );
$$;

-- ── case_section_comments ─────────────────────────────────────────────────
create table if not exists public.case_section_comments (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.cases(id) on delete cascade,
  -- Which kind of section this comment is anchored to.
  section_type   text not null check (section_type in ('evidence', 'event', 'calendar')),
  -- The identity of the anchored section within its kind: a timeline event id
  -- (for 'evidence' + 'event'), or an ISO period key like '2026-07-08' /
  -- '2026-07' / '2026' (for 'calendar'). Free text so a calendar day/period
  -- needs no extra table.
  target_ref     text not null,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body           text not null,
  created_at     timestamptz not null default now(),
  -- Soft delete so a removed comment leaves a tombstone rather than reflowing
  -- a thread others may be replying to.
  deleted_at     timestamptz
);
create index if not exists case_section_comments_anchor_idx
  on public.case_section_comments (case_id, section_type, target_ref, created_at);

alter table public.case_section_comments enable row level security;

drop policy if exists case_section_comments_select on public.case_section_comments;
create policy case_section_comments_select on public.case_section_comments
  for select to authenticated
  using (
    private.is_case_member(case_id) or private.is_firm_case_member(case_id)
  );

drop policy if exists case_section_comments_insert on public.case_section_comments;
create policy case_section_comments_insert on public.case_section_comments
  for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id))
  );

-- Authors may edit / soft-delete their own comments.
drop policy if exists case_section_comments_update on public.case_section_comments;
create policy case_section_comments_update on public.case_section_comments
  for update to authenticated
  using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

-- ── case_chat_messages ────────────────────────────────────────────────────
create table if not exists public.case_chat_messages (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.cases(id) on delete cascade,
  -- 'general' = the whole-case room (all members); 'dm' = a private thread
  -- between exactly two people, listed in `participants`.
  thread_kind    text not null default 'general' check (thread_kind in ('general', 'dm')),
  -- A stable grouping key. 'general' for the room; for a DM, the two user ids
  -- sorted and joined ('dm:<uuidA>:<uuidB>') so both sides resolve the same
  -- thread regardless of who opens it.
  thread_key     text not null default 'general',
  -- The two participant user ids for a DM (empty for the general room). Used
  -- by RLS to keep a DM private to its two people.
  participants   uuid[] not null default '{}',
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body           text not null,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists case_chat_messages_thread_idx
  on public.case_chat_messages (case_id, thread_key, created_at);

alter table public.case_chat_messages enable row level security;

-- Read: a case/firm member sees the general room; a DM is visible only to its
-- two participants.
drop policy if exists case_chat_messages_select on public.case_chat_messages;
create policy case_chat_messages_select on public.case_chat_messages
  for select to authenticated
  using (
    (private.is_case_member(case_id) or private.is_firm_case_member(case_id))
    and (thread_kind = 'general' or auth.uid() = any (participants))
  );

-- Post: must own the row, be allowed to contribute to the case, and (for a DM)
-- be one of its two participants.
drop policy if exists case_chat_messages_insert on public.case_chat_messages;
create policy case_chat_messages_insert on public.case_chat_messages
  for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id))
    and (thread_kind = 'general' or auth.uid() = any (participants))
  );

drop policy if exists case_chat_messages_update on public.case_chat_messages;
create policy case_chat_messages_update on public.case_chat_messages
  for update to authenticated
  using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

-- NOTE: after applying this migration to the live DB, regenerate the schema
-- fingerprint. CI will not catch it if you do not: the schema-drift gate
-- skips while the SUPABASE_DB_URL secret is unset (scripts/schema/README.md,
-- "Current status"). Regenerate with:
--   psql "$SUPABASE_DB_URL" -X -q -t -A -f scripts/schema/fingerprint-hash.sql \
--     | tr -d '[:space:]' > supabase/schema-fingerprint.sha256
