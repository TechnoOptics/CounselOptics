-- Which ways of signing a firm will accept, per template.
--
-- ========================= APPLIED TO PRODUCTION ==========================
-- Applied 2026-08-10 to project hpmtlhpyvbreyfimftgt (Advottic), and
-- VERIFIED against the live catalog rather than trusted from a success
-- flag: information_schema reports the column on both tables, pg_constraint
-- reports both CHECK constraints, and for the handoff table pg_class reports
-- relrowsecurity true with pg_policies reporting zero policies, which is the
-- intended posture since only the service role reaches it.
--
-- supabase/schema-fingerprint.sha256 was regenerated in the same change, by
-- running scripts/schema/fingerprint-hash.sql against the live database:
--   8f64d395... -> a0b9a98d...
--
-- The banner above previously said NOT APPLIED, which was true when written.
-- Correcting it is part of applying the migration, because until the
-- SUPABASE_DB_URL repo secret exists the CI drift gate self-skips and these
-- banners are the only record of applied state. A gate that reports success
-- without executing cannot contradict a stale header.
--
-- WHAT THIS IS FOR
--
-- A signer can make their mark four ways: draw it, type a name rendered in a
-- script face, hand the ceremony to their phone with the QR code, or attach
-- an image of a signature they already have. Firms do not all accept all
-- four. An uploaded image is the weakest of them for attribution, since the
-- firm learns nothing about who was holding the device when the pixels were
-- made, and some firms will not take one on an instrument they intend to
-- rely on. Others forbid a typed name. Until now the product offered all
-- four on every document and the firm had no say.
--
-- WHY TWO COLUMNS AND NOT ONE
--
-- firm_templates.signature_methods is the firm's setting: what this template
-- may be signed with, editable at any time.
--
-- firm_signing_requests.signature_methods is that setting FROZEN at the
-- moment the document was dispatched, and it is the one the server enforces.
-- Copied rather than joined, for the reason 20260807_flow_join.sql copies
-- category and delivery_mode onto the submission: the counterparty may hold
-- the signing link for weeks, and a template edited while they held it must
-- not retroactively invalidate the ceremony they were invited to, nor
-- silently widen it. It also keeps the dependency one-way. firm_signing_
-- requests is a generic record that knows nothing about templates and stays
-- usable for a plainly uploaded document, which is why this is a column on
-- it and not a lookup back through firm_template_submissions.
--
-- WHY NULLABLE, AND WHAT NULL MEANS
--
-- Null means "no restriction recorded", which is exactly what every existing
-- row means and exactly what the product does today: all four methods are
-- offered. So there is no backfill, nothing changes for any template or any
-- request already out for signature, and a firm that has not applied this
-- file sees the product it has now.
--
-- An EMPTY array is a different statement from null and the CHECK below
-- forbids it. lib/signature-methods.ts keeps the two apart deliberately:
-- null is unrestricted, a list is "exactly these", and a list that named
-- nothing would be a document nobody could sign. That case is refused here,
-- in lib/firm-templates.ts on the save, and in the picker component, because
-- the first of those three is the only one an attacker cannot skip.
--
-- WHY text[] AND NOT jsonb OR FOUR BOOLEANS
--
-- Four booleans cannot express "at least one" as a constraint without naming
-- all four in it, and adding a fifth method later would mean another column
-- and another edit to that predicate. jsonb would hold anything at all,
-- including a string or a number, and the point of this column is that the
-- set of legal values is small, closed and checkable by the database.
--
-- TRUST MODEL, unchanged. firm_templates carries RLS with NO policies and
-- every path reaches it through the service-role client behind a server
-- action that authorizes the caller in code. firm_signing_requests is
-- written by createSigningRequestAction under the caller's own session after
-- its firm-membership check. This file adds no policy and grants no new
-- reach.

alter table public.firm_templates
  -- Which of 'draw', 'type', 'phone', 'upload' this template may be signed
  -- with. Null means all four, which is what every row means today.
  add column if not exists signature_methods text[];

alter table public.firm_signing_requests
  -- The template's setting as it stood when this request was dispatched, or
  -- null for a request that carries no restriction (every existing row, and
  -- every request for a plainly uploaded document). lib/signature-write.ts
  -- reads this column and refuses a signature made by a method it does not
  -- name.
  add column if not exists signature_methods text[];

-- Written as separate do-blocks so re-running the file is safe. A bare
-- `add column ... check (...)` fails on the second run even with
-- `if not exists` on the column, which 20260806_template_signature_capture
-- already learned.
--
-- The predicate says three things, and each is load-bearing:
--
--   * null passes, because null is "unrestricted" and not "empty".
--   * `<@` bounds the array to the four known methods, so a value this
--     application does not understand cannot be stored. Without it an older
--     deployment reading a future method would have to choose between
--     refusing every signature and accepting every one.
--   * `cardinality(...) >= 1` is the "at least one method must remain
--     enabled" rule. It is stated here as well as in the save path because
--     every `'use server'` export in this application is a public HTTP
--     endpoint, and a rule that lives only in the endpoint is a rule that
--     holds until somebody writes a second endpoint.
--
-- Duplicates are deliberately NOT constrained here: CHECK cannot carry a
-- subquery, so de-duplication is done on the way in by
-- normalizeSignatureMethodSelection, and a repeated element changes no
-- decision this application makes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'firm_templates_signature_methods_check'
  ) then
    alter table public.firm_templates
      add constraint firm_templates_signature_methods_check
      check (
        signature_methods is null
        or (
          signature_methods <@ array['draw', 'type', 'phone', 'upload']::text[]
          and cardinality(signature_methods) >= 1
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'firm_signing_requests_signature_methods_check'
  ) then
    alter table public.firm_signing_requests
      add constraint firm_signing_requests_signature_methods_check
      check (
        signature_methods is null
        or (
          signature_methods <@ array['draw', 'type', 'phone', 'upload']::text[]
          and cardinality(signature_methods) >= 1
        )
      );
  end if;
end $$;

comment on column public.firm_templates.signature_methods is
  'Signature methods this template may be signed with, from (draw, type, phone, upload). Null means all four. Never empty: see the CHECK constraint.';

comment on column public.firm_signing_requests.signature_methods is
  'The dispatching template''s signature_methods, frozen at request creation. Null means no restriction. Enforced by lib/signature-write.ts.';
