-- The legal team's own fields on a request: phase 2, the contract family.
--
-- ============================ NOT APPLIED ================================
-- Applying this migration and then regenerating
-- supabase/schema-fingerprint.sha256 (scripts/schema/fingerprint-hash.sql,
-- computed server side) are the owner's steps. Apply it AFTER
-- 20260903_intake_legal_fields_internal.sql and BEFORE deploying the code
-- that writes these columns: the write REFUSES rather than retrying without
-- the column (setIntakeLegalFieldsAction, lib/firm-actions.ts), and the
-- expiry sweep in lib/deadlines.ts skips quietly while the columns are
-- absent. Reads are safe either way, because the counsel page selects `*`.
--
-- Nothing in CI can contradict this banner: the schema-drift gate self-skips
-- while the SUPABASE_DB_URL repo secret is unset. Whoever applies this should
-- replace the banner with the applied date. See scripts/schema/README.md.
-- =========================================================================
--
-- The contract dates and the expiry notice. Real columns for the reason the
-- phase 1 migration gives: the employee's page selects intake_answers whole,
-- so a legal-only value may not live there. These join the block on every
-- family that carries it, not only contracts, because an internal document
-- or a safekept instrument has an effective and an expiration date too.
--
-- The shared contract fields the employee files (entity, department,
-- document type, version requested, who signs) need NO migration: they are
-- the employee's own words and ride in intake_answers.contract.
--
-- NOTE ON intake_answers.expiry. The firm's own creation form has long
-- carried an "Expiry / valid until" date in the jsonb, filled by the legal
-- team at creation and shown to the employee. expires_on below is the
-- legal-only, editable date the block manages and the sweep reads. The old
-- key is left as it is; removing a field the form still offers is a
-- separate decision.

alter table public.firm_matter_intakes
  add column if not exists effective_on date,
  add column if not exists expires_on date,
  -- The legal team asked to be told before the date. A flag the sweep
  -- filters by, so a column rather than a note.
  add column if not exists notify_on_expiry boolean not null default false,
  -- Stamped by the sweep when the notice goes out, cleared by the action when
  -- the date moves, so one date produces one notice. Written by no client.
  add column if not exists expiry_notified_at timestamptz;

-- The one read these serve: "which contracts do we need to be told about".
-- Partial, because a request that asked for no notice is the ordinary case.
create index if not exists firm_matter_intakes_expiry_notice_idx
  on public.firm_matter_intakes (expires_on)
  where notify_on_expiry and expiry_notified_at is null;

-- No RLS change, for the reason the phase 1 migration gives.
