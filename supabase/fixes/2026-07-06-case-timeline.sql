-- Case Timeline Builder.
--
-- A user (often new to Advottic, arriving with a long history of collected
-- evidence) drops in photos, documents, receipts, voice notes, videos, and
-- chat screenshots; Bella analyses each item (OCR, date extraction, people
-- detection, chat sender/recipient parsing) and Advottic arranges everything
-- into a chronological, court-exportable timeline with tagged people.
--
-- Reuses the existing case-membership RLS helpers (is_case_member /
-- is_case_owner) and the `exhibits` storage bucket (media pathed under
-- userId/caseId/timeline/... so the bucket's member-scoped policies apply
-- unchanged). Idempotent: safe to re-run.

-- ── People referenced across the timeline (subjects, witnesses, opposing
--    parties, senders/recipients of messages). One row per person per case;
--    events reference them so the same person can be tagged across many items.
create table if not exists public.case_people (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  display_name text not null,
  role         text not null default 'other'
               check (role in ('subject','witness','opposing','support','other')),
  aliases      text[] not null default '{}',
  notes        text,
  -- Optional avatar (a cropped face / representative image) in the exhibits bucket.
  avatar_path  text,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists case_people_case_idx on public.case_people (case_id);

-- ── Timeline events. Each is one dated entry: media + the user's context +
--    Bella's structured analysis.
create table if not exists public.case_timeline_events (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.cases(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  -- When the event happened (nullable until known). Precision lets the UI/PDF
  -- render "March 2023" vs an exact timestamp, and sort sensibly.
  occurred_at   timestamptz,
  occurred_precision text not null default 'day'
                check (occurred_precision in ('exact','day','month','year','unknown')),
  kind          text not null default 'note'
                check (kind in ('photo','document','receipt','audio','video','message','note','event')),
  title         text not null default '',
  -- The user's own words: what this is and why it matters.
  description   text,
  -- Attached media: [{ path, mime, name, size }] in the exhibits bucket.
  media         jsonb not null default '[]'::jsonb,
  source_label  text,           -- e.g. "WhatsApp export", "Bank statement", "Ring camera"
  -- Bella's plain-English summary of this item.
  ai_summary    text,
  -- Structured analysis: { ocr_text, detected_dates[], detected_people[],
  --   message_thread: { platform, participants[], messages:[{ sender, recipient,
  --   timestamp, body }] }, objects[], suggested_title, confidence }.
  ai_extracted  jsonb not null default '{}'::jsonb,
  ai_status     text not null default 'pending'
                check (ai_status in ('pending','running','done','error','skipped')),
  ai_error      text,
  -- People tagged as present/involved (both AI-suggested + user-confirmed).
  people        uuid[] not null default '{}',
  -- Manual ordering fallback for events that share a date / have no date.
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists case_timeline_events_case_idx
  on public.case_timeline_events (case_id, occurred_at nulls last, position);
create index if not exists case_timeline_events_status_idx
  on public.case_timeline_events (ai_status) where ai_status in ('pending','running');

-- ── The generated narrative + conclusion (the "legal document" view). One
--    current draft per case; regenerated on demand from the events.
create table if not exists public.case_timeline_narratives (
  case_id      uuid primary key references public.cases(id) on delete cascade,
  summary      text,              -- executive overview
  narrative    text,              -- chronological prose
  conclusion   text,              -- the reasoned conclusion
  event_count  integer not null default 0,
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now()
);

-- ── RLS: scoped to case membership, mirroring exhibits/collaborators.
alter table public.case_people             enable row level security;
alter table public.case_timeline_events    enable row level security;
alter table public.case_timeline_narratives enable row level security;

drop policy if exists case_people_member_all on public.case_people;
create policy case_people_member_all on public.case_people
  for all to authenticated
  using (private.is_case_member(case_id))
  with check (private.is_case_member(case_id));

drop policy if exists case_timeline_events_member_all on public.case_timeline_events;
create policy case_timeline_events_member_all on public.case_timeline_events
  for all to authenticated
  using (private.is_case_member(case_id))
  with check (private.is_case_member(case_id));

drop policy if exists case_timeline_narratives_member_select on public.case_timeline_narratives;
create policy case_timeline_narratives_member_select on public.case_timeline_narratives
  for select to authenticated
  using (private.is_case_member(case_id));
-- Writes to the narrative go through the service-role generator action.
