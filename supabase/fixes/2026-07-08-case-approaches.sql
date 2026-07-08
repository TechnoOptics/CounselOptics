-- 2026-07-08  Case approaches: the firm "prove-the-case" approach builder. A
-- lawyer writes their APPROACH (the theory they are trying to prove) and
-- Advottic assembles the matter's evidence into a structured argument with
-- cited EXHIBITS and a supporting TIMELINE. Each is saved as "Approach 1/2/3",
-- editable and re-runnable.
--
-- `generated` jsonb holds { thesis, argument, exhibits:[{exhibit,title,why}],
-- timeline:[{when,title,significance}], gaps:[] } (null until first run). Every
-- exhibit reference is grounded in the matter's own evidence digest; the model
-- may not cite an exhibit that is not on file.
--
-- firm_id is denormalised onto the row (the matter already carries it) so the
-- RLS firm check does not need to join through cases.
--
-- Access mirrors public.case_images / public.case_legal_reviews: consumer case
-- members reach it via RLS; firm members (NOT case members of a firm matter) go
-- through the ADMIN client gated in application code on firm membership +
-- case.firm_id. SELECT also admits firm members via private.is_firm_case_member
-- so the Slice-3 client view can read it (client sees the full case minus
-- firm-internal ops; an approach is case substance, so it carries).

create table if not exists public.case_approaches (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  firm_id      uuid references public.firms(id) on delete cascade,
  title        text not null,
  -- The lawyer's theory in their own words ("what I'm trying to prove").
  prompt       text not null default '',
  -- The assembled argument; null until the first successful generation.
  generated    jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists case_approaches_case_idx on public.case_approaches (case_id, created_at);

alter table public.case_approaches enable row level security;

drop policy if exists case_approaches_select on public.case_approaches;
create policy case_approaches_select on public.case_approaches
  for select to authenticated
  using (private.is_case_member(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_approaches_insert on public.case_approaches;
create policy case_approaches_insert on public.case_approaches
  for insert to authenticated
  with check (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_approaches_update on public.case_approaches;
create policy case_approaches_update on public.case_approaches
  for update to authenticated
  using (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id))
  with check (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

drop policy if exists case_approaches_delete on public.case_approaches;
create policy case_approaches_delete on public.case_approaches
  for delete to authenticated
  using (private.can_add_to_case(case_id) or private.is_firm_case_member(case_id));

-- NOTE: regenerate the schema fingerprint after applying (schema-drift gate).
