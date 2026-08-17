-- Narrow INSERT on public.profiles the same way UPDATE was narrowed.
--
-- ==================== APPLIED TO PRODUCTION 2026-08-17 ===================
-- Applied immediately after 20260817_profiles_column_grants.sql, and verified
-- afterwards by reading information_schema rather than by trusting the apply
-- call: authenticated now holds INSERT on 24 columns and UPDATE on the same
-- 24, no table level INSERT or UPDATE remains for authenticated or anon, and
-- the seven withheld columns retain only SELECT and REFERENCES.
--
-- supabase/schema-fingerprint.sha256 regenerated in the same commit,
-- a3eeae25 to 19ea6b98.
-- =========================================================================
--
-- WHY THIS EXISTS SEPARATELY FROM ITS SIBLING.
--
-- The UPDATE fix closed the door a user would actually have walked through,
-- and it was written believing that was the whole of it. It was not. A second
-- door was pointed out by a parallel review, and it is worth recording that
-- the first fix was incomplete rather than quietly widening the earlier file.
--
-- profiles_upsert_own permits an INSERT where auth.uid() = id, and
-- authenticated held a table wide INSERT covering all 31 columns. A user with
-- NO profile row could therefore have created one naming themselves an
-- operator. The UPDATE narrowing does not stop that, because an INSERT is not
-- an UPDATE.
--
-- MEASURED BEFORE APPLYING, so this is recorded as depth rather than as a
-- live hole that was open: 65 auth users, 65 profile rows, nobody without
-- one, and NO delete policy exists on the table, so a row cannot be removed
-- and re-created to reach the insert path. The trigger that creates the
-- profile runs in the same transaction as the user insert, so there is no
-- window between them either.
--
-- It costs nothing to close, and one failed trigger is all it would take to
-- make it live.
--
-- Also note for anyone reasoning about a PostgREST upsert here: an upsert is
-- INSERT ... ON CONFLICT DO UPDATE, so it needs the privilege on BOTH verbs
-- for every column it names. That is why the two column lists below and in
-- the sibling file are identical, and they must stay identical.
revoke insert on public.profiles from authenticated;
revoke insert on public.profiles from anon;

grant insert (
  id,
  display_name,
  role,
  organization,
  avatar_url,
  updated_at,
  consented_at,
  tour_completed_at,
  representation,
  theme,
  language,
  active_firm_id,
  auto_topup_enabled,
  auto_topup_threshold,
  auto_topup_package,
  menu_preferences,
  dashboard_preferences,
  safe_contact_email,
  safe_witness_pin,
  safe_witness_message,
  phone,
  first_name,
  phone_number,
  phone_verified_at
) on public.profiles to authenticated;

-- SELECT is deliberately left alone on the withheld columns. A person reading
-- their own balance, their own trial and their own operator flag is correct
-- and is what the product does. Only the write side was ever the problem.
