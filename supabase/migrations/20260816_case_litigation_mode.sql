-- Two modes for a firm matter: a request, or a court case.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-10. NOT run against production. Applying it, and then
-- regenerating supabase/schema-fingerprint.sha256, are the owner's steps.
--
-- This banner is the only record of applied state right now: the CI schema
-- drift gate self-skips while the SUPABASE_DB_URL repo secret is unset, so a
-- stale fingerprint and a wrong header both pass green. Seven headers in this
-- repo have claimed the wrong thing. Whoever runs this corrects the banner in
-- the same commit as the regenerated fingerprint.
--
-- The application does NOT require this migration to deploy. lib/case-file.ts
-- selects litigation_mode and, on PostgREST error 42703 (undefined_column),
-- retries the read without it, so until this runs every matter resolves on the
-- hearing trigger alone and the open/close control returns a calm sentence
-- explaining that the database update is still pending. Nothing crashes and
-- nothing is hidden that the hearing trigger would not hide anyway.
-- =========================================================================
--
-- The firm matter page shipped as one shape for every matter: a case menu of
-- four court surfaces, a metric strip, an evidence-analytics dashboard nested
-- in a collapsible tile, and the Case Theory Console. A policy question from
-- an employee got the page a wrongful-termination suit gets. The owner:
--
--   "Please only use this screen if there is a court case, or the firm has
--    selected build a case. This is not how normal employee requests should
--    appear. This is only the court case view."
--
-- Two triggers, so two things to store, and only one of them is new. "There is
-- a court case" is already on this table as hearing_at / hearing_location,
-- typed in by a person filling in the matter form. "The firm selected build a
-- case" is this column.
--
-- Why a column and not jsonb: `cases` has no metadata bag. Every alter on this
-- table in the repo was checked - posture, subject_profile, hearing_at,
-- hearing_location, hearing_notes, assigned_to, sandbox, text_normalizations,
-- matter_number - and none of them is general-purpose. The firms.metadata trick
-- that let the firm-type work ship migration-free an hour ago is simply not
-- available here. subject_profile is jsonb and already carries one non-party
-- key, so it could physically hold this; it is the party dossier, edited field
-- by field by the matter form, and burying the shape of the whole page inside
-- the record of who the other side is would be a trap for the next reader.

alter table public.cases
  -- Nullable with NO default, and three-valued on purpose:
  --
  --   true   a person opened the case file on this matter.
  --   false  a person closed it. This beats the hearing trigger, because a
  --          matter switched back to a request has to STAY a request even
  --          though the hearing that opened it is still on the record. A
  --          control that cannot do that is not a switch.
  --   null   nobody has said. Fall through to the hearing trigger.
  --
  -- `default false` would have been wrong for the same reason a NOT NULL
  -- DEFAULT false is wrong on firm_settings.hide_time_billing, and for the
  -- same reason lib/firm-workspace.ts had to read that column as a hide-only
  -- latch: a stored false you cannot tell apart from never-touched is not an
  -- answer, it is a guess wearing an answer's clothes.
  add column if not exists litigation_mode boolean;

comment on column public.cases.litigation_mode is
  'Has the firm opened the case file on this matter? true = opened by a person, false = closed by a person (beats the hearing trigger), null = never decided, fall through to hearing_at / hearing_location. Resolved in lib/case-mode.ts.';

-- One-time backfill, so applying this does not take a workbench away from a
-- matter somebody is in the middle of.
--
-- It writes true where litigation work ALREADY exists, turning "there is case
-- work here" into stored, explicit state a person can then switch off. That is
-- the whole reason it is a backfill and not a runtime rule: as a runtime rule
-- it could never be switched off, because the work it looks at is exactly the
-- work switching the mode off is supposed to hide.
--
-- Deliberately narrow. It never writes false, so a matter it does not match is
-- left at null and keeps resolving on the hearing trigger; and `litigation_mode
-- is null` makes it idempotent, so a re-run cannot overturn a decision anyone
-- has made since.
update public.cases c
   set litigation_mode = true
 where c.firm_id is not null
   and c.litigation_mode is null
   and (
        c.hearing_at is not null
     or exists (select 1 from public.case_approaches a where a.case_id = c.id)
     or exists (select 1 from public.case_timeline_events e where e.case_id = c.id)
   );

-- No index. The column is only ever read one matter at a time, by primary key,
-- on a row the page has already fetched. An index here would be a control with
-- nothing behind it.
