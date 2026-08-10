-- A template can override its firm's page layout.
--
-- ============================== APPLIED ==================================
-- Written 2026-08-08. APPLIED to production. This header said NOT APPLIED
-- until 2026-08-10 and was wrong.
--
-- WHAT SETTLED IT, from the repo alone: commit c1f9088b, "Regenerate the
-- fingerprint for firm_templates.document_layout", is an ancestor of main
-- and a descendant of 81f6c749, the commit that added this file. It says in
-- terms that "20260809_template_document_layout.sql is applied to
-- production: one nullable jsonb column, no default, no CHECK. Verified in
-- the live database rather than inferred from the absence of an error." It
-- regenerated supabase/schema-fingerprint.sha256 in the same change, so
-- nothing is owed.
--
-- The banner survived the apply because a later commit (33e3c32c) edited
-- this file without revisiting the header.
--
-- The CI drift gate is designed to hash the live schema against that
-- committed fingerprint, but it is not doing so: it self-skips while the
-- SUPABASE_DB_URL secret is unset, so it has never executed a comparison
-- and could not have contradicted the stale banner. See
-- scripts/schema/README.md, "Current status".
-- =========================================================================
--
-- WHAT THIS IS HALF OF. The firm-wide default lives on
-- firms.metadata.document_layout and needs no migration, following the
-- letterhead design precedent: firms.metadata is an existing jsonb column and
-- every read of it goes back through normalizeDocumentLayout
-- (lib/document-layout.ts), which is the trust boundary for a bag this code
-- does not own. firm_templates has no such bag, so the per-template override
-- needs a column of its own. This is that column and nothing else.
--
-- WHY NULLABLE, AND WHY NO DEFAULT. Null is not "no layout", it is "this
-- template does not override the firm". resolveDocumentLayout merges a stored
-- value over the firm's before normalizing either, so a null override resolves
-- to exactly the firm layout. A default of '{}' would mean the same thing and
-- read as though every template had been configured, which is a worse thing for
-- a person to find in the column.
--
-- WHY NO CHECK CONSTRAINT ON THE SHAPE. The set of fields a layout carries is
-- declared by the DocumentLayout type in lib/document-layout.ts, and a
-- constraint listing them here would be a second copy of that vocabulary in a
-- language that cannot import the first. It would go stale the first time a
-- band gains a field. What protects the column instead is that the ONLY reader
-- is normalizeDocumentLayout, which clamps every number to a real bound and
-- discards every key it does not recognise, so the worst a bad value can do is
-- resolve to the default layout. That is the fail-safe direction: the document
-- the firm was already getting.
--
-- WHAT THIS CANNOT DO. It cannot move a document that has already been
-- rendered. A document's bytes are stored at first render and every
-- counterparty blank's geometry is recorded in the same write
-- (lib/submission-document.ts), and nothing re-renders a stored document. A
-- layout is an input to a render that has not happened yet.
--
-- RLS. firm_templates carries RLS with NO policies and every path reaches it
-- through the service-role client behind an explicit gate (requireAuthor in
-- lib/firm-templates.ts). Adding a column changes none of that, so there is no
-- policy to write here.

begin;

alter table public.firm_templates
  add column if not exists document_layout jsonb;

comment on column public.firm_templates.document_layout is
  'Partial page-layout override for this template, merged over the firm''s '
  'firms.metadata.document_layout by resolveDocumentLayout in '
  'lib/document-layout.ts. Null means this template does not override the '
  'firm. Normalized on every read; never trusted as stored.';

commit;
