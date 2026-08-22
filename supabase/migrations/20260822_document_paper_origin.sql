-- Whose paper a stored document is.
--
-- =========================== APPLIED TO PRODUCTION 2026-08-22 ==========================
-- Applied on 2026-08-22, BEFORE this code was merged, which is the ordering
-- the 2026-08-07 deploy settled. It matters here specifically: the write of
-- paper_origin ABORTS rather than retrying without the column, so shipping
-- the code first would have failed every firm document filing until the
-- column existed.
--
-- Verified after applying by reading information_schema rather than by
-- trusting the apply call. supabase/schema-fingerprint.sha256 was
-- regenerated in the same commit, 19ea6b98 to f8b5a1b0, computed server
-- side by scripts/schema/fingerprint-hash.sql.
--
-- The CI drift gate self-skips until the SUPABASE_DB_URL repo secret exists,
-- so this banner is the only record of applied state, which is exactly why
-- it was corrected here rather than left to rot.
--
-- WHAT THIS IS FOR
--
-- Two kinds of paper now travel through the same table. There is the firm's
-- own document, rendered by lib/pdf.ts buildBrandedDocumentPdf out of a
-- template a colleague filled in, and there is the counterparty's document,
-- uploaded exactly as it arrived because somebody outside the company has
-- asked the firm to sign it.
--
-- They must not be handled the same way. The firm's own paper may be
-- re-rendered, re-branded and re-worded, because it is the firm's wording.
-- The counterparty's may not be touched at all: a third-party instrument that
-- has been through a renderer is no longer the instrument that was sent, and
-- the firm would be signing something the sender never wrote. So the product
-- needs to be able to tell them apart, and it cannot tell them apart today.
--
-- WHY NULLABLE, AND WHY NOTHING IS BACKFILLED
--
-- Null is not "unknown, ask later". Null READS as 'third_party', in exactly
-- one function, readPaperOrigin in lib/document-provenance.ts, and every
-- surface goes through it.
--
-- That is the fail-safe direction. Reading an unlabelled document as the
-- firm's own would let the product re-render paper it had no right to touch.
-- Reading it as somebody else's costs nothing but a preserved file.
--
-- It is also, as it happens, the truth for the whole existing table. Every
-- row in firm_documents today was either uploaded by a firm member, which is
-- paper the firm did not render, or produced by the submission path, which is
-- the ONE writer this change teaches to say 'firm'. So a backfill would have
-- to invent a provenance claim for rows nobody recorded one for, on documents
-- that may be evidence. It is left alone.
--
-- ON THE COLUMN-MISSING FALLBACK, WHICH IS AN ABORT AND NOT A RETRY
--
-- This repo has a settled pattern for a write naming a column a migration has
-- not added yet: resolveDeliveryModeColumnFallback in lib/submission-dispatch.ts
-- and resolveDocumentLayoutColumnFallback in lib/template-document-layout.ts.
-- Both retry without the column when the dropped value is what an absent
-- column already means, and both abort when it is not.
--
-- Applying that test here gives an answer that is not the obvious one, so it
-- is written out.
--
-- Dropping 'firm' on a retry does NOT weaken the never-rewrite protection. It
-- over-applies it: the row falls back to 'third_party', so the document is
-- preserved rather than exposed. On the protection alone, a retry would be
-- safe.
--
-- It aborts anyway, for a different reason. The row would carry a false and
-- PERMANENT provenance claim. There is no backfill and nothing later
-- re-derives provenance, so a document the firm rendered itself would be
-- labelled as the counterparty's for the rest of its life, and the surfaces
-- would tell a reader, on a legal document, "Sent to us by X. Kept exactly as
-- received." That statement would be untrue and nobody would ever find out.
--
-- So the choice is between a loud, recoverable failure and a silent,
-- permanent falsehood, which is the same test the two fallbacks above apply
-- and lands the same way: the write aborts with a named error, the approved
-- submission stays approved and retryable, and applying this migration makes
-- the retry succeed. See PAPER_ORIGIN_UNSAVED_ERROR in
-- lib/document-provenance.ts and the abort in lib/submission-document.ts.

alter table public.firm_documents
  add column if not exists paper_origin text
    check (paper_origin in ('firm', 'third_party'));

comment on column public.firm_documents.paper_origin is
  'Whose paper this is. Null reads as third_party (fail-safe: unknown paper '
  'is somebody else''s and is preserved, never re-rendered). Set to firm only '
  'by lib/submission-document.ts, which is the one writer that knows the '
  'bytes came out of buildBrandedDocumentPdf. Not backfilled: see the header '
  'of supabase/migrations/20260822_document_paper_origin.sql.';
