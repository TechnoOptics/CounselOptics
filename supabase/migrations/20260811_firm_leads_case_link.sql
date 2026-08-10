-- Link a marketplace lead to the matter a firm opened from it.
--
-- ============================== APPLIED ==================================
-- APPLIED to production, and the fingerprint regenerated. This header said
-- "It is not applied here" until 2026-08-10; that was true of the commit
-- that introduced the file and stopped being true one commit later.
--
-- WHAT SETTLED IT, from the repo alone: commit 8f846660, "Apply the
-- lead-to-matter link and regenerate the fingerprint", is an ancestor of
-- main and a descendant of 3a54ca7c, the commit that added this file. It
-- says "firm_leads.case_id is applied to production and verified: uuid,
-- nullable, one index, on delete set null", and it regenerated
-- supabase/schema-fingerprint.sha256 from the live schema (1241 to 1243
-- lines, the two new lines being the foreign key and the partial index).
-- Nothing is owed.
--
-- Nothing in CI could have contradicted the stale banner: the schema-drift
-- gate self-skips while the SUPABASE_DB_URL secret is unset, so it has never
-- executed a comparison (scripts/schema/README.md, "Current status"). The
-- fingerprint now covers function EXECUTE grants and table/column grants as
-- well as structure, but only a configured gate would ever read it.
-- =========================================================================
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
