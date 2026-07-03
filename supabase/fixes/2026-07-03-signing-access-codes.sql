-- Signing access codes (#5): dual link + one-time-code delivery.
--
-- When a document is sent for signature to an EXTERNAL signer, we email
-- two things to the same address:
--   1. a single-use link to /sign/<token> (already existed), and
--   2. a short numeric access code they must enter before the document
--      is shown.
--
-- Requiring both proves the recipient controls the mailbox the firm
-- addressed - a forwarded/leaked link alone can't open the document.
-- The code is a SECRET, so we persist only its SHA-256 hash (never the
-- plaintext), verify by hashing the entry, and mark it consumed on the
-- first successful entry (one-time use). `access_attempts` backs a
-- lockout so the short code can't be brute-forced.
--
-- Internal signers (a member/employee of the same firm) get NO code:
-- they're already authenticated and the document also lands in their
-- portal dashboard, so a second factor would be friction with no gain.
--
-- Idempotent: safe to re-run. No RLS change - firm_signatures is
-- written only via the service-role client (see getSignatureByToken /
-- createSigningRequestAction), and these columns follow that model.

alter table public.firm_signatures
  add column if not exists access_code_hash text,
  add column if not exists access_code_verified_at timestamptz,
  add column if not exists access_attempts integer not null default 0;

comment on column public.firm_signatures.access_code_hash is
  'SHA-256 of the one-time access code emailed to an external signer. NULL = no code required (internal signer). Plaintext is never stored.';
comment on column public.firm_signatures.access_code_verified_at is
  'When the signer entered the correct access code. Non-NULL = the code was consumed and the token is unlocked for signing.';
comment on column public.firm_signatures.access_attempts is
  'Failed access-code entries; backs a brute-force lockout on the short code.';
