-- 2026-07-02: phone verification, needed for the Community Case
-- organizer-eligibility gate (Personal Plus+/Growing Firm+ AND verified
-- email AND verified phone). Account-level, not feature-specific, so it
-- lives on profiles rather than a community_* table - any future feature
-- that wants "confirmed real phone number" can reuse this.
alter table public.profiles
  add column if not exists phone_number text;
alter table public.profiles
  add column if not exists phone_verified_at timestamptz;
