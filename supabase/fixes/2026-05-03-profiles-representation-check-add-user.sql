-- 2026-05-03: profiles.representation CHECK constraint missed 'user'.
--
-- ConsentModal.tsx offers four options: Self-represented, Represented,
-- I'm counsel, Just exploring. The first three map to
-- 'self_represented' / 'represented' / 'counsel'; "Just exploring" maps
-- to 'user'. The server action lib/actions.ts validates against all four,
-- but the DB CHECK constraint was tighter and only allowed the first
-- three, so any "Just exploring" sign-up failed with:
--   new row for relation "profiles" violates check constraint
--   "profiles_representation_check"
-- which surfaced as the generic "Server Components render" error and
-- trapped new users on the consent modal indefinitely.
--
-- Fix: rebuild the constraint with all four values. Idempotent.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_representation_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_representation_check
  CHECK (
    representation IS NULL
    OR representation = ANY (ARRAY['self_represented', 'represented', 'counsel', 'user']::text[])
  );
