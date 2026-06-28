-- 2026-06-28: close public-bucket listing + pin trigger search_path.
--
-- 1. Remove broad SELECT (listing) policies on the two public DISPLAY buckets.
-- Public object access continues via getPublicUrl (the bucket's public flag +
-- the public CDN endpoint), which does not consult storage.objects SELECT
-- policies. The app only uses getPublicUrl / upload / admin-side remove on
-- these buckets — it never lists them via the anon/authenticated API — so
-- dropping these closes file-enumeration without affecting avatar/logo display.
drop policy if exists "avatars_storage_select" on storage.objects;
drop policy if exists "firm_logos_public_read" on storage.objects;

-- 2. Pin search_path on the updated_at trigger functions (defense-in-depth
-- against search_path manipulation on SECURITY DEFINER-style functions).
-- These only set NEW.updated_at = now(); now() resolves via pg_catalog so an
-- empty search_path is safe.
alter function public.set_updated_at() set search_path = '';
alter function public.feedback_set_updated_at() set search_path = '';
alter function public.touch_enterprise_inquiries_updated_at() set search_path = '';
alter function public.firm_integrations_touch_updated_at() set search_path = '';
