-- Editing the account of what happened, without losing the earlier version.
--
-- `cases.description` is the person's own written account, captured by the
-- `description` textarea in app/cases/new/case-form.tsx when the case is
-- created. Until now nothing could change it after creation. Making it
-- editable means the earlier text has to survive the edit: it is the version
-- closest in time to the events, and on this product it is evidence.
--
-- Two changes, both additive and both safe to re-run.
--
-- 1. `description_history`: the superseded versions, verbatim, each with the
--    timestamp of the edit that replaced it. Shape:
--      [{ "text": "...", "replacedAt": "2026-08-22T00:00:00.000Z" }, ...]
--    The application writes `description` and `description_history` in ONE
--    update statement, so the new text can never land without the old text
--    being preserved alongside it.
--
-- 2. `case_description_updated` on the audit_events event_type check. That
--    check is a closed list, and lib/activity.ts logCaseEvent swallows its
--    insert error, so an event type the database does not accept produces no
--    audit entry and no complaint. This is the same gap the 2026-06-28 fix
--    closed for 'witness_statement_updated'.
--
-- UNTIL THIS IS APPLIED, editing an account is refused rather than performed:
-- lib/storage.ts updateCaseComposition writes both columns together, so a
-- missing column fails the whole statement and the person is told the change
-- was not saved. Nothing is lost, and nothing is silently half-written.

alter table public.cases
  add column if not exists description_history jsonb not null default '[]'::jsonb;

do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'public.audit_events'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%event_type%';
  if cname is not null then
    execute format('alter table public.audit_events drop constraint %I', cname);
  end if;
end $$;

alter table public.audit_events add constraint audit_events_event_type_check
  check (event_type in (
    'case_created','case_viewed','case_status_changed','case_deleted',
    'exhibit_uploaded','exhibit_deleted','review_run','hearing_updated',
    'collaborator_invited','collaborator_removed','witness_statement_updated',
    'imported','case_description_updated'
  ));
