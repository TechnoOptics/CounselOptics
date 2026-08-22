-- Withdrawing an exhibit, and editing an exhibit's details.
--
-- ======================= APPLIED TO PRODUCTION 2026-08-22, SECTIONS 1 AND 2 ONLY ============
-- Sections 1 and 2 were applied on 2026-08-22 and the fingerprint was
-- regenerated in the same commit. Section 3 was NOT applied, for the reason
-- set out below. The
-- schema-drift gate compares that fingerprint against the live schema, so the
-- two go together in one change.
--
-- The application behaves correctly before it is applied, and the two halves
-- behave DIFFERENTLY on purpose:
--
--   READING is safe to degrade. `listExhibits` selects '*' and filters
--   withdrawn rows in JavaScript, so an absent column simply reads as "not
--   withdrawn". That is exactly right, because on a database without the
--   column nothing can have been withdrawn. A `.is('withdrawn_at', null)`
--   clause in the query instead would make every case page, packet and export
--   fail outright until this ran, and would find nothing when it did.
--
--   WRITING is not safe to degrade, so it refuses. There is no version of a
--   withdrawal that can be retried with the column left out. Dropping it would
--   leave the exhibit exactly where it was while telling the person it had
--   been withdrawn, and they would find out from the packet in front of a
--   judge. lib/exhibit-withdrawal.ts resolveWithdrawnColumnFallback returns
--   'abort-not-withdrawn' and the person is told plainly that nothing changed.
--
-- Section 3 is the only part with any chance of breaking something. It can be
-- left out without affecting sections 1 and 2; read its note before deciding.
-- =========================================================================
--
-- WHY A COLUMN AND NOT A DELETE.
--
-- Labels are allocated by position: lib/storage.ts addExhibit counts the rows
-- already on the case and hands out the next letter. Delete Exhibit K and the
-- row is gone, but every packet already printed, every review already written
-- and every note the person has made still say "Exhibit K", and the next
-- upload takes K. The reference silently comes to mean a different document.
--
-- So nothing is destroyed. The row stays, the label stays, the file stays in
-- the exhibits bucket, and one timestamp records that the person chose to
-- leave it out of the packet, the chronology, the exhibit index and the
-- unread count. They can put it back.


-- ---------------------------------------------------------------------------
-- 1. The column
-- -----------------------------------------------------------------------------
-- SECTIONS 1 AND 2 APPLIED 2026-08-22. SECTION 3 WAS NOT.
--
-- Verified after applying by reading the catalog rather than trusting the
-- apply call: withdrawn_at present on exhibits, the three new audit values
-- present, and every value the constraint carried before still carried.
-- Fingerprint d1cdb00c to 812b2ecc.
--
-- Section 3, the column grant narrowing, is deliberately NOT applied yet.
-- It is the right change and it is the same shape as the profiles fix made
-- earlier today, but another session is concurrently building a path that
-- REPLACES an exhibit's file, which writes storage_path and file_name. If
-- that path ships, section 3 breaks it. The two designs disagree about
-- whether a label may keep pointing at different bytes, and that has to be
-- settled before the grant is narrowed around one of them.

alter table public.exhibits
  add column if not exists withdrawn_at timestamptz;

comment on column public.exhibits.withdrawn_at is
  'When the case owner withdrew this exhibit from their packet. NOT a delete: '
  'the row, the label and the file in the exhibits bucket are all kept, because '
  'labels are allocated by position and removing one silently re-points every '
  'existing reference to it. NULL means the exhibit is in use.';


-- ---------------------------------------------------------------------------
-- 2. The audit event types
-- ---------------------------------------------------------------------------
--
-- audit_events.event_type is a CLOSED check constraint, and lib/activity.ts
-- logCaseEvent swallows its insert error, so an event type the database does
-- not accept produces no audit entry and no complaint. Three new types have to
-- be added to it, or an edit and a withdrawal leave no trace.
--
-- THIS DOES NOT RECREATE THE CONSTRAINT FROM A HARD-CODED LIST. A recreate
-- from a list silently drops whatever the list forgot, and this constraint has
-- already been rebuilt twice (2026-06-28 for 'imported' and
-- 'witness_statement_updated', 2026-08-22 for 'case_description_updated'), so
-- a stale copy of the list is a live risk rather than a hypothetical one.
--
-- Instead the values currently allowed are READ OUT of the live constraint
-- definition and carried forward, and the three new ones are added to what was
-- found. If the parse comes back empty while a constraint exists, this raises
-- and changes nothing, because a recreate from a failed parse would be exactly
-- the silent narrowing this is written to avoid.
--
-- At the time of writing the live list is the thirteen values below. They are
-- named here as documentation and as a floor to check against, never as the
-- source the new constraint is built from:
--   case_created, case_viewed, case_status_changed, case_deleted,
--   exhibit_uploaded, exhibit_deleted, review_run, hearing_updated,
--   collaborator_invited, collaborator_removed, witness_statement_updated,
--   imported, case_description_updated

do $$
declare
  cname   text;
  cdef    text;
  allowed text[];
  missing text[];
  known   text[] := array[
    'case_created','case_viewed','case_status_changed','case_deleted',
    'exhibit_uploaded','exhibit_deleted','review_run','hearing_updated',
    'collaborator_invited','collaborator_removed','witness_statement_updated',
    'imported','case_description_updated'
  ];
  added   text[] := array[
    'exhibit_details_updated','exhibit_withdrawn','exhibit_restored'
  ];
  v text;
begin
  select conname, pg_get_constraintdef(oid)
    into cname, cdef
    from pg_constraint
   where conrelid = 'public.audit_events'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%event_type%';

  if cname is null then
    -- No constraint to carry forward. Take the values actually in the table so
    -- a new constraint cannot reject a row that is already stored.
    select coalesce(array_agg(distinct e.event_type), array[]::text[])
      into allowed
      from public.audit_events e
     where e.event_type is not null;
    raise notice 'no event_type constraint found; seeding from % stored value(s)',
      coalesce(array_length(allowed, 1), 0);
  else
    -- Every single-quoted literal in the definition is one allowed value.
    select coalesce(array_agg(distinct t.m[1]), array[]::text[])
      into allowed
      from regexp_matches(cdef, '''([^'']+)''', 'g') as t(m);

    if coalesce(array_length(allowed, 1), 0) = 0 then
      raise exception
        'Could not read any allowed value out of the live event_type constraint. '
        'Nothing was changed. Definition was: %', cdef;
    end if;

    -- Say out loud if the live list is missing something this repo believes is
    -- in use. Not fatal, because the live database is the authority, but it is
    -- the difference between a known gap and a silent one.
    select coalesce(array_agg(k), array[]::text[])
      into missing
      from unnest(known) as k
     where not (k = any (allowed));
    if coalesce(array_length(missing, 1), 0) > 0 then
      raise notice 'live constraint does not carry: %', missing;
    end if;
  end if;

  foreach v in array added loop
    if not (v = any (allowed)) then
      allowed := allowed || v;
    end if;
  end loop;

  -- Union with the values this repo knows are in use, so nothing that was
  -- already being logged can be lost even if the parse above under-read.
  foreach v in array known loop
    if not (v = any (allowed)) then
      allowed := allowed || v;
    end if;
  end loop;

  if cname is not null then
    execute format('alter table public.audit_events drop constraint %I', cname);
  end if;

  execute format(
    'alter table public.audit_events add constraint audit_events_event_type_check '
    'check (event_type = any (%L::text[]))',
    allowed
  );

  raise notice 'audit_events.event_type now allows % value(s): %',
    array_length(allowed, 1), allowed;
end $$;


-- ---------------------------------------------------------------------------
-- 3. Which exhibit columns a signed-in user may write
-- ---------------------------------------------------------------------------
--
-- OPTIONAL, AND THE ONLY PART OF THIS FILE THAT CAN BREAK ANYTHING. Sections 1
-- and 2 are additive. This one narrows a grant, so read it before running it.
--
-- WHAT IT FIXES. 20260810_update_policies_collaborators_exhibits.sql added
-- `exhibits_update_uploader_or_owner`, which lets the uploader or the case
-- owner update an exhibit row. It did NOT narrow the column grant the way the
-- same file narrowed case_collaborators, so `authenticated` still holds a
-- blanket table-level UPDATE grant on every exhibit column. RLS cannot express
-- "these columns may change and those may not": USING sees the old row and
-- WITH CHECK sees the new one, and neither can compare the two. A column grant
-- is the mechanism that can.
--
-- The application already refuses to write anything else: the details update
-- is built by buildExhibitDetailsPatch in lib/exhibit-withdrawal.ts, which
-- returns exactly four keys. This makes that a property of the database rather
-- than of one function, so `label` and `storage_path` cannot be reached
-- through the anon key at all, whatever any future call site does.
--
-- WHAT STAYS WRITABLE, and why each one has to:
--   description, incident_date, source, category  the details edit
--   scan_data                                     saveExhibitScan, which runs
--                                                 on the user-scoped client
--   withdrawn_at                                  the withdrawal
--
-- Verified before writing: `.from('exhibits').update(` appears exactly once in
-- the application, in lib/storage.ts saveExhibitScan, writing scan_data. If a
-- path is added later that writes another column through the user client, it
-- will fail until that column is granted here.
--
-- service_role is untouched, so every admin path keeps its full grant. INSERT
-- is untouched, because addExhibit legitimately writes every column when the
-- row is created; a grant cannot be revoked column by column, so the whole
-- UPDATE grant is dropped and the six columns are granted back.

begin;

revoke update on public.exhibits from anon;
revoke update on public.exhibits from authenticated;

grant update (description, incident_date, source, category, scan_data, withdrawn_at)
  on public.exhibits to authenticated;

commit;
