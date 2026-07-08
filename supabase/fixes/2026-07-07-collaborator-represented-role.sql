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
-- decides who may INSERT exhibits).
--
-- The committed schema.sql historically shows only ('viewer','editor',
-- 'attorney'), while application code also writes 'witness'. To be robust
-- to whatever the live constraint actually is, we drop ANY existing
-- role-related CHECK constraint on the table by discovery, then re-add the
-- full, correct set. Idempotent.

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

-- can_add_to_case: owner OR an editor/attorney/represented collaborator may
-- add exhibits to a case. Adding 'represented' lets an invited client
-- contribute their own evidence. (Recreating the function preserves its
-- existing privileges; grants below are idempotent and match schema.sql.)
create or replace function public.can_add_to_case(_case_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
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

revoke execute on function public.can_add_to_case(uuid) from public;
grant execute on function public.can_add_to_case(uuid) to authenticated;
