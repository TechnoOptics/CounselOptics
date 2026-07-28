-- Intake conversation: a real message table (replacing the append-only
-- intake_answers.thread jsonb), ticket participants, tokenized "send us a
-- file" links, per-ticket documents, and an assignee.
--
-- Why a table instead of the jsonb array: every previous write was a
-- read-modify-write of the whole `intake_answers` blob with no locking, so
-- two people replying at the same moment could silently drop a message.
-- Rows also give us Realtime (the point of this change), per-message
-- visibility (shared vs internal legal-only), attachments, and mentions.
--
-- Trust model matches the rest of the firm surface: ALL writes go through
-- the service-role admin client behind server actions that authorize the
-- actor in code. RLS therefore only needs SELECT policies — but it needs
-- them, because Supabase Realtime honours RLS for the subscribing user.
--
-- Order matters here: Postgres validates a function body at CREATE time and
-- the helpers below query firm_intake_participants, so the tables are
-- declared first, then the helpers, then the policies that use them.

-- ── participants (invited watchers on a ticket) ───────────────────────────
create table if not exists public.firm_intake_participants (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.firm_matter_intakes(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null,
  -- 'assignee' owns the ticket; 'watcher' just follows it.
  role text not null default 'watcher' check (role in ('watcher', 'assignee')),
  added_by uuid,
  created_at timestamptz not null default now(),
  unique (intake_id, user_id)
);
create index if not exists firm_intake_participants_intake_idx
  on public.firm_intake_participants (intake_id);
create index if not exists firm_intake_participants_user_idx
  on public.firm_intake_participants (user_id);
alter table public.firm_intake_participants enable row level security;

-- ── messages ──────────────────────────────────────────────────────────────
create table if not exists public.firm_intake_messages (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.firm_matter_intakes(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  author_user_id uuid,
  author_name text not null default 'Someone',
  -- 'system' rows are the activity trail (status changed, file received…).
  author_role text not null check (author_role in ('employee', 'legal', 'system')),
  -- 'internal' is legal-team-only: never shown to the requester, never
  -- emailed to them, never pushed to the partner webhook.
  visibility text not null default 'shared' check (visibility in ('shared', 'internal')),
  body text not null default '',
  -- [{ name, path, size, type, documentId }]
  attachments jsonb not null default '[]'::jsonb,
  mentions uuid[] not null default '{}',
  -- 'message' = a person wrote it; 'event' = the system recorded it.
  kind text not null default 'message' check (kind in ('message', 'event')),
  event_type text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists firm_intake_messages_intake_idx
  on public.firm_intake_messages (intake_id, created_at);
create index if not exists firm_intake_messages_firm_idx
  on public.firm_intake_messages (firm_id, created_at desc);
alter table public.firm_intake_messages enable row level security;

-- ── tokenized upload requests ("send us this file") ──────────────────────
create table if not exists public.firm_intake_upload_requests (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.firm_matter_intakes(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  token text not null unique,
  label text not null,
  note text,
  created_by uuid,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  completed_at timestamptz,
  upload_count int not null default 0,
  max_files int not null default 10,
  created_at timestamptz not null default now()
);
create index if not exists firm_intake_upload_requests_intake_idx
  on public.firm_intake_upload_requests (intake_id, created_at desc);
alter table public.firm_intake_upload_requests enable row level security;
-- No policies: the public /send/[token] page and every firm read go through
-- the service-role client. Default-deny for anon/authenticated is intended.

-- ── helpers (SECURITY DEFINER so policies can't recurse) ──────────────────
create or replace function private.is_intake_firm_member(_intake_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.firm_matter_intakes i
    where i.id = _intake_id
      and private.is_firm_member(i.firm_id, auth.uid())
  );
$$;

create or replace function private.can_view_intake(_intake_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.firm_matter_intakes i
    where i.id = _intake_id
      and (
        private.is_firm_member(i.firm_id, auth.uid())
        or i.created_by = auth.uid()
        or exists (
          select 1 from public.firm_intake_participants p
          where p.intake_id = i.id and p.user_id = auth.uid()
        )
      )
  );
$$;

-- ── policies ──────────────────────────────────────────────────────────────
do $$ begin
  create policy firm_intake_participants_select on public.firm_intake_participants
    for select using (private.can_view_intake(intake_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_intake_messages_select on public.firm_intake_messages
    for select using (
      private.is_intake_firm_member(intake_id)
      or (visibility = 'shared' and private.can_view_intake(intake_id))
    );
exception when duplicate_object then null; end $$;

-- Realtime must be able to stream this table to subscribers.
do $$ begin
  alter publication supabase_realtime add table public.firm_intake_messages;
exception when duplicate_object then null; end $$;

-- ── ticket-scoped documents + an owner ───────────────────────────────────
alter table public.firm_documents
  add column if not exists intake_id uuid references public.firm_matter_intakes(id) on delete set null;
create index if not exists firm_documents_intake_idx
  on public.firm_documents (intake_id, status_updated_at desc) where intake_id is not null;

alter table public.firm_matter_intakes
  add column if not exists assigned_to uuid;
create index if not exists firm_matter_intakes_assigned_idx
  on public.firm_matter_intakes (assigned_to) where assigned_to is not null;

-- ── backfill: lift every existing jsonb thread message into the table ─────
insert into public.firm_intake_messages
  (intake_id, firm_id, author_user_id, author_name, author_role, visibility, body, kind, created_at)
select
  i.id,
  i.firm_id,
  case when m->>'byUserId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then (m->>'byUserId')::uuid else null end,
  coalesce(nullif(m->>'name', ''), 'Someone'),
  case when m->>'role' = 'legal' then 'legal' else 'employee' end,
  'shared',
  coalesce(m->>'text', ''),
  'message',
  coalesce((m->>'at')::timestamptz, i.created_at)
from public.firm_matter_intakes i
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(i.intake_answers->'thread') = 'array'
       then i.intake_answers->'thread' else '[]'::jsonb end
) as m
where not exists (
  select 1 from public.firm_intake_messages x where x.intake_id = i.id
);
