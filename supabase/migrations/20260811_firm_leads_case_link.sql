-- Link a marketplace lead to the matter a firm opened from it.
--
-- APPLYING THIS IS THE OWNER'S STEP. It is not applied here, and
-- supabase/schema-fingerprint.sha256 must be regenerated after it is applied.
-- The schema-drift gate in CI will not enforce that today: it skips while the
-- SUPABASE_DB_URL secret is unset (scripts/schema/README.md, "Current
-- status"). The fingerprint now covers function
-- EXECUTE grants and table/column grants as well as structure.
--
-- WHY IT IS NEEDED. An accepted lead had no exit: the firm-side page offered a
-- mailto: and a tel: link and nothing else, so a firm that won a lead re-keyed
-- the client, the summary and the jurisdiction into a new matter by hand. The
-- intake lane already has the exit (firm_matter_intakes.case_id, written by
-- convertIntakeToCaseAction); this is the same column on the same footing, so
-- leads use that mechanism rather than a second one.
--
-- WHAT DEPENDS ON IT. lib/lead-conversion.ts reads this column to stay
-- idempotent - it is what tells a first conversion from a repeated one - and
-- lib/marketplace-storage.ts reads it to decide whether the "Open a matter"
-- control is shown at all. Both treat a missing column as "not supported" and
-- degrade to the previous behaviour rather than erroring, so this file being
-- unapplied leaves the surface exactly as it was.
--
-- ON DELETE SET NULL, not CASCADE: deleting a matter must not delete the
-- consumer's lead record, which belongs to the consumer and not to the firm.

alter table firm_leads
  add column if not exists case_id uuid references cases(id) on delete set null;

create index if not exists firm_leads_case_idx
  on firm_leads (case_id) where case_id is not null;
