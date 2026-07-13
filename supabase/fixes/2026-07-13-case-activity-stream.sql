-- Case activity stream: a per-matter feed of who did what, so the case owner /
-- firm can see when an outside co-counsel (guest) logs in, views the matter,
-- opens a section, comments, or downloads the packet.
--
-- Security posture (mirrors witness_submissions):
--   * WRITES go through the service-role client only (server actions / API
--     routes that have already authorized the actor). There is deliberately NO
--     insert policy for anon/authenticated roles.
--   * READS are restricted to firm members of the matter's owning firm. A guest
--     can never read the stream; the panel is firm-internal.
--
-- Idempotent.

create table if not exists public.case_activity (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  firm_id uuid,
  actor_user_id uuid,
  actor_email text,
  actor_label text,
  -- 'guest' (outside co-counsel), 'firm' (a firm member), 'client', 'system'
  actor_kind text not null default 'guest',
  -- login | view_matter | view_timeline | view_evidence | open_section
  --   | comment | download | export
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists case_activity_case_created_idx
  on public.case_activity (case_id, created_at desc);

alter table public.case_activity enable row level security;

-- Read: any firm member of the matter's owning firm. No write policy => the
-- service-role key is the only writer.
drop policy if exists case_activity_firm_read on public.case_activity;
create policy case_activity_firm_read on public.case_activity
  for select
  using (
    exists (
      select 1
      from public.cases c
      join public.firm_members fm on fm.firm_id = c.firm_id
      where c.id = case_activity.case_id
        and fm.user_id = auth.uid()
    )
  );
