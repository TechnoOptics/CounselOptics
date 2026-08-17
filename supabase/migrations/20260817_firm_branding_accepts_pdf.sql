-- Let the firm-branding bucket accept the PDF letterhead the app already offers.
--
-- ======================= NOT APPLIED TO PRODUCTION ========================
-- Applying this is the owner's step, and so is regenerating
-- supabase/schema-fingerprint.sha256 afterwards if the gate covers it.
--
-- NOTE ON THE FINGERPRINT: this migration touches storage.buckets, which is a
-- ROW in a Supabase-managed table, not a change to the public schema. The
-- drift gate hashes the public schema, so this is not expected to move the
-- fingerprint. Regenerate and compare rather than taking that on trust.
-- =========================================================================
--
-- WHAT IS BROKEN WITHOUT IT
--
-- The full-page vector letterhead shipped and cannot be used. lib/firm-actions.ts
-- accepts 'application/pdf' in LETTERHEAD_MIME, chooses a '.pdf' extension, and
-- lib/branded-document-pdf.ts embeds the artwork with embedPdf so a 6.5pt address
-- line stays vector. But the bucket's own allowed_mime_types list is
--
--   image/png, image/jpeg, image/jpg, image/webp, image/svg+xml
--
-- so storage refuses the object before any of that runs. The upload fails with
-- "mime type application/pdf is not supported", surfaced to the firm as a raw
-- storage string. Measured by attempting the real upload against production,
-- not inferred from the bucket row.
--
-- THE SIZE LIMIT IS THE SAME CLASS OF DEFECT. uploadFirmLetterheadAction admits
-- a file up to 8 MB and the bucket caps objects at 3 MB, so a 4 MB letterhead
-- passes the app's own check and is then rejected by storage with a different
-- raw string. The two limits are aligned here at the app's 8 MB rather than the
-- app being lowered, because a sheet of stationery with a photographic
-- background genuinely exceeds 3 MB and the app's number is the deliberate one.
--
-- WHY WIDENING THE BUCKET IS THE RIGHT HALF TO CHANGE. The alternative is to
-- stop accepting PDFs in the action, which would delete the vector path that
-- the full-page fit exists for and leave rasterised stationery as the only
-- option. The bucket is public and holds firm branding only; the app is still
-- the gatekeeper on type and size, and it still refuses SVG for the letterhead
-- because pdf-lib cannot draw one.
--
-- SVG STAYS ALLOWED because firm LOGOS use this same bucket and at least one
-- firm's logo is an SVG today. Removing it would break that logo.

update storage.buckets
set
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml'
  ],
  file_size_limit = 8388608
where id = 'firm-branding';
