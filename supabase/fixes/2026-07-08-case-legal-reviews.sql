-- 2026-07-08  Case legal reviews: the firm "prove-the-case" legal-review
-- surface. Surfaces the laws / claims implicated by the matter facts + evidence
-- in the matter's state, each backed by a legal basis, recommended actions,
-- statute references, and CourtListener-VERIFIED case citations. One latest
-- review per matter (unique case_id); regenerating upserts it.
--
-- The `generated` jsonb holds { overview, state, claims:[{ title, legalBasis,
-- elements[], recommendedActions[], statutes[], cases[] }] }, where every
-- entry in `cases` was confirmed to exist in CourtListener before it was
-- stored (see lib/courtlistener.ts). Unverified candidates are dropped in
-- application code and never persisted.
--
-- Access mirrors public.case_images: consumer case members (owner +
-- case_collaborators) reach it via RLS; firm members (NOT case members of a
-- firm matter) go through the ADMIN client gated in application code on firm
-- membership + case.firm_id. The SELECT policy also admits firm members via
-- private.is_firm_case_member so the Slice-3 client view can read it directly.

create table if not exists public.case_legal_reviews (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  -- The state / jurisdiction the review was generated for, snapshotted so a
  -- later jurisdiction edit is visibly out of date rather than silently wrong.
  state        text,
  generated    jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists case_legal_reviews_case_uk on public.case_legal_reviews (case_id);

alter table public.case_legal_reviews enable row level security;

drop policy if exists case_legal_reviews_select on public.case_legal_reviews;
create policy case_legal_reviews_select on public.case_legal_reviews
  for select to authenticated
  using (private.is_case_member(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_legal_reviews_insert on public.case_legal_reviews;
create policy case_legal_reviews_insert on public.case_legal_reviews
  for insert to authenticated
  with check (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_legal_reviews_update on public.case_legal_reviews;
create policy case_legal_reviews_update on public.case_legal_reviews
  for update to authenticated
  using (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id))
  with check (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_legal_reviews_delete on public.case_legal_reviews;
create policy case_legal_reviews_delete on public.case_legal_reviews
  for delete to authenticated
  using (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

-- NOTE: regenerate the schema fingerprint after applying (schema-drift gate).
