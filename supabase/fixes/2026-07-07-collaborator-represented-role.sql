-- 2026-07-07  case_collaborators: add the 'represented' role
--
-- The firm case-invite panel (counsel/cases/[id]) lets a law firm invite
-- people to a matter with four clear roles, mapped onto case_collaborators:
--   represented -> 'represented'  (client / represented party)
--   co-counsel  -> 'attorney'
--   contributor -> 'editor'
--   viewer      -> 'viewer'
--
-- 'represented' is a new first-class role: the client can view the matter
-- AND contribute their own evidence/statements, so it must be allowed by
-- the role CHECK constraint and by can_add_to_case() (the RLS gate that
-- decides who may INSERT exhibits, and — via the exhibits storage bucket
-- policy — upload the underlying file).
--
-- NOTE: the RLS helper functions were moved from `public` to the `private`
-- schema (2026-06-27-move-rls-helpers-to-private-schema.sql), and the live
-- exhibits / storage INSERT policies call `private.can_add_to_case`. This
-- migration therefore updates the PRIVATE function - updating a public copy
-- would be a no-op. The live role CHECK already includes 'witness' (added
-- out of band); we drop any existing role CHECK by discovery and re-add the
-- full, correct set so the migration is robust regardless. Idempotent.

do $$
declare
  cname text;
begin
  for cname in
    select conname
    from pg_constraint
    where conrelid = 'public.case_collaborators'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format(
      'alter table public.case_collaborators drop constraint %I',
      cname
    );
  end loop;
end $$;

alter table public.case_collaborators
  add constraint case_collaborators_role_check
  check (role in ('viewer', 'editor', 'attorney', 'witness', 'represented'));

-- private.can_add_to_case: owner OR an editor/attorney/represented
-- collaborator may add exhibits. Adding 'represented' lets an invited
-- client contribute their own evidence. Recreating the function preserves
-- its existing privileges (granted to authenticated/anon/service_role).
create or replace function private.can_add_to_case(_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    exists (select 1 from public.cases where id = _case_id and user_id = auth.uid())
    or exists (
      select 1 from public.case_collaborators
      where case_id = _case_id
        and user_id = auth.uid()
        and role in ('editor', 'attorney', 'represented')
    );
$$;
