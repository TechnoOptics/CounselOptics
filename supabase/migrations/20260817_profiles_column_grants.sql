-- Stop a signed-in user writing their own is_admin.
--
-- ==================== APPLIED TO PRODUCTION 2026-08-17 ===================
-- Applied on discovery, because this was live and reachable, not a latent
-- risk. Verified afterwards by reading information_schema rather than by
-- trusting the apply call: table wide UPDATE on public.profiles now belongs
-- to postgres and service_role only, authenticated holds column grants that
-- exclude all seven columns below, and anon holds none.
--
-- supabase/schema-fingerprint.sha256 is regenerated in the same commit. The
-- fingerprint hashes ACLs as well as definitions, which is deliberate: it was
-- extended to cover grants after credit_firm_token_pool was found executable
-- by authenticated. See scripts/schema/fingerprint-hash.sql.
-- =========================================================================
--
-- WHAT WAS OPEN.
--
-- public.profiles carries is_admin. private.is_admin(uid) is a one line read
-- of that column, and isCurrentUserAdmin is the gate on the whole HQ operator
-- surface (app/admin/layout.tsx). The row is writable by its owner through
-- profiles_update_own, whose USING and WITH CHECK are both auth.uid() = id.
--
-- That policy is correct and is not the defect. RLS decides WHICH ROWS a
-- statement may touch. It cannot say which COLUMNS, so a policy that lets a
-- user update their own row lets them update every column of it. The only
-- mechanism in Postgres that can draw a line at the column is a GRANT, and
-- there was none: authenticated held a plain table wide UPDATE, inherited
-- from Supabase's default grants to the API roles.
--
-- So any signed in user could PATCH their own profiles row over PostgREST
-- with is_admin true and become an operator. The same opening covered
-- token_balance, the trial columns and is_blocked.
--
-- This is the third time this shape has been found in this project: an api
-- tokens policy that let any user mint an admin scoped token for any firm,
-- and seven public token money endpoints. The common thread is a control that
-- reads as enforcement but is not in the request path.
--
-- WHY THE FIX IS SHAPED THIS WAY.
--
-- A table level privilege cannot be revoked column by column. Revoking UPDATE
-- on a column while the table level grant stands has no effect at all, which
-- would have produced a migration that looked like a fix, passed, and changed
-- nothing. The grant has to be revoked whole and re-issued over the safe
-- columns.
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

-- Everything a person legitimately writes about themselves. id is included
-- because an upsert restates the conflict key, and WITH CHECK (auth.uid() =
-- id) still prevents the row being pointed at somebody else.
grant update (
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

-- WITHHELD. Every writer of each of these was read before the grant was
-- narrowed, and every one of them uses the service role client, which is
-- unaffected by a revoke from authenticated:
--
--   is_admin                  grants the HQ operator surface
--   is_blocked                a blocked account could restore itself
--                             (lib/storage.ts adminSetUserBlocked, admin)
--   token_balance             money (lib/token-economy.ts, lib/storage.ts,
--                             lib/item-limits.ts, all admin)
--   token_quota_period_end    money (lib/token-economy.ts, admin)
--   token_overage_period_end  money (lib/item-limits.ts, admin)
--   trial_ends_at             entitlement (lib/user-trials.ts, admin)
--   trial_tier                entitlement (lib/user-trials.ts, admin)
--
-- STILL OPEN, DELIBERATELY, AND NOT CLOSED BY THIS FILE.
--
-- phone_verified_at IS granted, because confirmPhoneVerificationCodeAction
-- (lib/phone-verify-actions.ts) writes it with the CALLER'S client after
-- Twilio approves the code. Revoking it here would have broken phone
-- verification outright.
--
-- The consequence is that a user can still stamp their own phone_verified_at
-- over PostgREST and skip Twilio, which matters because that timestamp is one
-- of the gates on Community Case organizer eligibility. The fix is to move
-- that single write to the admin client and then withdraw the column, which
-- is a code change and does not belong in a grants migration. Recorded here
-- rather than left silent, so the next person reads a known gap instead of
-- assuming this file closed everything.
