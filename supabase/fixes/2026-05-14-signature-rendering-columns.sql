-- Signature-rendering pipeline (2026-05-14) - schema for the
-- "append signature box at the bottom when OCR / structural
-- detection finds nothing" feature.
--
-- Two new columns:
--
--   1. public.firm_documents.signable_file_path
--      Storage path to a derived copy of the source PDF that has
--      signature boxes drawn onto it (one per signer who had no
--      detected anchor). When non-null, the in-app signing UI and
--      the final-render step both prefer this path over file_path
--      so the user sees the same artifact the renderer will stamp.
--
--      file_path is left untouched - it remains the original
--      bytes the firm uploaded, so the request's SHA-256 chain
--      stays grounded in the bytes the firm consented to.
--
--   2. public.firm_signing_requests.signed_file_path
--      Storage path to the executed PDF produced by the final-
--      render step after all signers have completed. Set once
--      lib/signature-render.ts uploads `signed/<request-id>/
--      final.pdf`.
--
--      This header used to claim the /counsel/signing UI linked to
--      this path for "Download executed copy". It did not. Nothing
--      read the column at all for months: the executed PDF was
--      rendered, uploaded, and unreachable, and every counsel
--      surface previewed the original, so a completed signing showed
--      a document with an empty signature line.
--
--      Its readers, as of the change that closed that:
--        lib/firm-storage.ts        maps it onto FirmSigningRequest
--                                   and mints a signed URL for it
--        lib/signing-artifact.ts    decides when it is the artifact
--                                   to show, and what to say when a
--                                   completed request lacks one
--        app/counsel/signing/[id]   preview + "Download executed copy"
--        app/counsel/documents/[id] same, via the document's most
--                                   recently completed request
--
--      Note this file lives under supabase/fixes/, not
--      supabase/migrations/, so whether either column exists on a
--      given deployment is a question about what was applied by
--      hand. Every read of signed_file_path therefore goes through
--      `select('*')` and treats the column not coming back as "no
--      executed copy", which the UI states rather than hides.
--
-- Both columns are nullable + additive: older code paths that
-- don't know about them keep working unchanged.

alter table public.firm_documents
  add column if not exists signable_file_path text;

comment on column public.firm_documents.signable_file_path is
  'When non-null, the storage path under firm-documents that holds a derived copy of file_path with signature boxes appended (see lib/signature-anchors.ts). The signer UI and the final-render step prefer this path over file_path.';

alter table public.firm_signing_requests
  add column if not exists signed_file_path text;

comment on column public.firm_signing_requests.signed_file_path is
  'Storage path under firm-documents to the executed PDF produced by lib/signature-render.ts once all signers have completed. Written only by that render step, in a direct update on this row. The final_pdf_rendered audit event records the same path in its metadata, but it is a record of the render, not a writer of this column: nothing reads the audit trail back into it.';

do $$
declare
  has_signable boolean;
  has_signed boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='firm_documents' and column_name='signable_file_path'
  ) into has_signable;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='firm_signing_requests' and column_name='signed_file_path'
  ) into has_signed;
  if not (has_signable and has_signed) then
    raise exception '[signature-rendering] missing columns: signable_file_path=%, signed_file_path=%',
      has_signable, has_signed;
  end if;
  raise notice '[signature-rendering] columns present: signable_file_path + signed_file_path.';
end $$;
