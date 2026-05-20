-- Safe Witness email body extension: include a pre-shared PIN (so
-- the contact can verify the alert is genuinely from this user)
-- and a custom message that opens the email (defaults to a canned
-- "I need help" line when empty).
--
-- Idempotent. Re-runnable.

alter table public.profiles
  add column if not exists safe_witness_pin text,
  add column if not exists safe_witness_message text;

comment on column public.profiles.safe_witness_pin is
  'Pre-shared code the user and their Safe Witness contact agreed on. Included in every alert email so the contact can verify the alert is genuinely from this user.';

comment on column public.profiles.safe_witness_message is
  'The line the user wants their Safe Witness contact to read first when an alert fires. Defaults to a canned "I need help" message when empty.';
