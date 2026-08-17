-- Let the firm-branding bucket accept the font files the app now offers to store.
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
-- uploadFirmTypefaceAction in lib/firm-actions.ts stores the firm's font in this
-- bucket with contentType 'font/ttf' or 'font/otf', and lib/branded-document-pdf.ts
-- embeds it. Neither type is in the bucket's allowed_mime_types list, so storage
-- refuses the object before any of that runs and the firm is shown a raw storage
-- string. Exactly the failure the PDF letterhead hit, for the same reason.
--
-- ONLY TWO TYPES ARE ADDED, and that is worth saying because a font upload is
-- the kind of thing that usually forces application/octet-stream into a bucket
-- policy. It does not here. Browsers report fonts inconsistently, but the action
-- never passes the browser's answer through: it sniffs the magic bytes, decides
-- for itself whether the file is TrueType or OpenType CFF, and uploads under the
-- registered type for what it actually found (RFC 8081). So the bucket only ever
-- sees font/ttf or font/otf, and octet-stream stays out of a PUBLIC bucket.
--
-- THIS APPENDS RATHER THAN REPLACING, AND THE FILENAME IS PART OF THE FIX.
--
-- 20260817_firm_branding_accepts_pdf.sql is also unapplied and it REPLACES the
-- whole allowed_mime_types array. This migration was first written the same way
-- and dated the same day, which was a live bug: `accepts_fonts` sorts BEFORE
-- `accepts_pdf`, so a runner applying files in filename order would have run the
-- PDF one last and silently dropped both font types, leaving the typeface
-- feature broken in exactly the way this migration exists to prevent.
--
-- Two changes close it. The date is moved to the 18th so it sorts last, and the
-- statement now UNIONS the font types into whatever the array already holds
-- instead of asserting a full list. That makes it idempotent, safe to run
-- before or after the PDF migration, and correct whether or not that one is
-- ever applied. Nothing already allowed is removed, which matters because firm
-- LOGOS share this bucket and at least one firm's logo is an SVG today.
--
-- THE SIZE LIMIT ONLY EVER RISES, for the same order-independence reason. It
-- lands at the 8 MB the letterhead migration also wants. The typeface action
-- caps its own uploads at 4 MB, so the app stays the stricter of the two: the
-- letterhead work found the opposite arrangement, where the action admitted more
-- than the bucket did, and the firm got a raw storage error instead of an answer.

update storage.buckets
set
  allowed_mime_types = array(
    select distinct m
    from unnest(
      coalesce(allowed_mime_types, array[]::text[]) || array['font/ttf', 'font/otf']
    ) as m
    order by m
  ),
  file_size_limit = greatest(coalesce(file_size_limit, 0), 8388608)
where id = 'firm-branding';
