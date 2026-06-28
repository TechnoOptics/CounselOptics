-- 2026-06-28: allow the 'imported' audit event type (migration history as
-- real timeline entries with preserved dates). Also adds the missing
-- 'witness_statement_updated' value (was in the app enum but not the DB check).
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
    'collaborator_invited','collaborator_removed','witness_statement_updated','imported'
  ));
