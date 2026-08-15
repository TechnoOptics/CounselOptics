-- One-time handoffs that let a SIGNED-IN employee move from their desk to
-- their own phone to draw a signature, by scanning a QR code.
--
-- ========================= APPLIED TO PRODUCTION ==========================
-- Applied 2026-08-10 to project hpmtlhpyvbreyfimftgt (Advottic), and
-- VERIFIED against the live catalog rather than trusted from a success
-- flag: information_schema reports the column on both tables, pg_constraint
-- reports both CHECK constraints, and for the handoff table pg_class reports
-- relrowsecurity true with pg_policies reporting zero policies, which is the
-- intended posture since only the service role reaches it.
--
-- supabase/schema-fingerprint.sha256 was regenerated in the same change, by
-- running scripts/schema/fingerprint-hash.sql against the live database:
--   8f64d395... -> a0b9a98d...
--
-- The banner above previously said NOT APPLIED, which was true when written.
-- Correcting it is part of applying the migration, because until the
-- SUPABASE_DB_URL repo secret exists the CI drift gate self-skips and these
-- banners are the only record of applied state. A gate that reports success
-- without executing cannot contradict a stale header.
--
-- WHY A SECOND TABLE AND NOT firm_signature_handoffs
--
-- That table's signature_id is a NOT NULL foreign key to firm_signatures. An
-- employee filling their own firm's template has no row there and will not
-- get one: their mark lands on a firm_template_submissions row that does not
-- exist until they submit, or on a PDF they export and never file. There is
-- nothing to point signature_id at. Everything above the storage layer IS
-- reused: lib/mark-handoff.ts delegates the state machine, both expiry
-- windows, the token hashing and the cookie comparison to
-- lib/signing-handoff.ts, and the phone draws on the same pad component.
--
-- WHAT THE PHONE CAN DO WITH ONE OF THESE ROWS, WHICH IS ALMOST NOTHING
--
-- The outside signer's phone completes a signature. This one cannot. The
-- employee is authenticated by a SESSION, and a code photographed off their
-- screen must never become a second way to hold it. A phone that scans this
-- may write exactly one PNG to exactly this row and may read nothing at all:
-- not the document, not the form, not a mark, not the employee's identity
-- beyond the display name the pad prints. The desk session collects the
-- picture and remains the only thing that can file anything.
--
-- WHY THE IMAGE IS A COLUMN AND NOT A BUCKET OBJECT
--
-- It is in flight, not at rest. It exists between the phone posting it and
-- the desk's next poll, a second or two later, and collect_at nulls it. What
-- survives is mark_sha256, which is what lets the server say the picture the
-- desk later submits is the one the bound phone drew rather than one the desk
-- substituted. A bucket object would outlive the ceremony and need sweeping;
-- a column that is set and then cleared does not.

begin;

create table if not exists public.firm_mark_handoffs (
  id uuid primary key default gen_random_uuid(),

  -- Both cascade: a handoff is scaffolding for one ceremony and must not
  -- outlive the firm, the person, or the template it belongs to.
  firm_id uuid not null references public.firms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references public.firm_templates (id) on delete cascade,

  -- Only the hash is stored, following firm_signature_handoffs.token_hash and
  -- firm_signatures.access_code_hash. A row here is a live bearer credential
  -- for the window it stays valid, so a leaked backup must not hand out a
  -- usable secret.
  token_hash text not null unique,

  -- Hash of the httpOnly cookie issued to the phone that scans the QR. Null
  -- until scanned, set once, never rewritten.
  session_hash text,

  created_at timestamptz not null default now(),

  -- When the UNSCANNED code dies, fifteen minutes past minting. Never
  -- extended by scanning: the phone gets its own ten-minute window measured
  -- from consumed_at, computed rather than stored, exactly as
  -- 20260801_signature_handoffs.sql explains.
  expires_at timestamptz not null,

  consumed_at timestamptz,
  consumed_ip text,
  consumed_user_agent text,

  -- The mark, in flight. Set by the phone, nulled by the desk's collection.
  mark_png text,
  mark_sha256 text,
  mark_at timestamptz,
  -- When the phone affirmed intent on the pad. Corroboration beside the
  -- affirmation the desk records; not a substitute for it.
  mark_intent_at timestamptz,

  -- When the desk read the picture off this row.
  collected_at timestamptz,

  -- Set when this mark was spent on a submission. A phone mark attests
  -- 'phone' for one document, not for every document the employee files
  -- afterwards, so the attestation is consumed here the way the token was
  -- consumed by the scan.
  used_at timestamptz
);

-- Neither column is selected by the application: every read in
-- lib/mark-handoff-queries.ts finds its row by token_hash (unique) or by
-- primary key. The index is for the cascades, which delete by firm_id and by
-- user_id and would otherwise scan the whole table.
create index if not exists firm_mark_handoffs_owner_idx
  on public.firm_mark_handoffs (user_id, created_at desc);

create index if not exists firm_mark_handoffs_firm_idx
  on public.firm_mark_handoffs (firm_id, created_at desc);

-- RLS on with no policy at all, exactly as firm_signature_handoffs. Both
-- sides of this feature run server-side against the service-role client,
-- which bypasses RLS, so neither needs a policy to work, and a table holding
-- hashed bearer credentials and an in-flight signature image should default
-- to closed. Adding a policy later would be widening access this table was
-- never meant to have.
alter table public.firm_mark_handoffs enable row level security;

comment on table public.firm_mark_handoffs is
  'One-time desk-to-phone handoffs for a signed-in employee signing a firm template. The phone may write one PNG and read nothing. See lib/mark-handoff.ts.';

commit;
