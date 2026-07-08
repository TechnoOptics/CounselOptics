-- 2026-07-08  Case images: party portraits + case-context images shown on the
-- matter details. Stored in the exhibits bucket; this table is the index.
--
-- Access mirrors the other case-scoped firm tables: consumer case members
-- (owner + case_collaborators) reach it through their authed client via RLS;
-- firm members (who are NOT case members of a firm matter) go through the ADMIN
-- client gated in application code on firm membership + case.firm_id, and the
-- SELECT policy also admits firm members via private.is_firm_case_member (added
-- in 2026-07-08-case-timeline-collab.sql). Posting mirrors private.can_add_to_case.

create table if not exists public.case_images (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  -- 'party'   = a photo of a person/party involved in the matter.
  -- 'context' = a case-context image (scene, object, reference).
  kind         text not null check (kind in ('party', 'context')),
  storage_path text not null,
  label        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists case_images_case_idx on public.case_images (case_id, kind, created_at);

alter table public.case_images enable row level security;

drop policy if exists case_images_select on public.case_images;
create policy case_images_select on public.case_images
  for select to authenticated
  using (private.is_case_member(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_images_insert on public.case_images;
create policy case_images_insert on public.case_images
  for insert to authenticated
  with check (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_images_delete on public.case_images;
create policy case_images_delete on public.case_images
  for delete to authenticated
  using (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

-- NOTE: regenerate the schema fingerprint after applying (schema-drift gate).
