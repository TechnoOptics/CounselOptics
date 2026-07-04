-- Product H3 (audit 2026-07-03): Projects was a silo with no way to
-- attach a project to the matter it's for. Add an optional case link so
-- a project can belong to a case, and be reached in-context from it.
-- ON DELETE SET NULL: deleting a case doesn't delete its project binders.

alter table public.firm_projects
  add column if not exists case_id uuid
    references public.cases(id) on delete set null;

create index if not exists firm_projects_case_id_idx
  on public.firm_projects(case_id) where case_id is not null;
