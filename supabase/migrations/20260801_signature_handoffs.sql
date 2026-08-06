-- One-time handoffs that let a signer move from their laptop to their
-- own phone to draw a signature, by scanning a QR code.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-06 on branch feat/qr-mobile-signing. The owner applies
-- this and regenerates supabase/schema-fingerprint.sha256 in the same
-- change, or the CI drift gate fails on the next push.
-- =========================================================================
--
-- Why a separate token rather than reusing firm_signatures.token:
-- access_code_hash is set only for external signers, so an internal
-- signer's durable /sign/[token] URL is, by itself, sufficient to sign.
-- Encoding that URL in a QR would mean anyone who photographs the screen
-- can sign as that person. This token instead authorises exactly one
-- action on exactly one signature row, is consumed on first scan, and
-- dies within minutes either way. lib/signing-handoff.ts (task 1 of this
-- feature) is the pure module that decides what state a row is in; this
-- table only needs to store what that module reads.
--
-- The raw token is never stored, only its hash (token_hash), following
-- the access_code_hash precedent already set on firm_signatures. A row
-- here is a live bearer credential for the window it stays valid, so a
-- leaked row (backup, replica, log line) must not hand out a usable
-- secret the way a leaked raw token would.
--
-- Two independent expiries, one stored column. The unscanned code dies
-- at expires_at, fifteen minutes after minting (HANDOFF_TTL_MINUTES in
-- lib/signing-handoff.ts). Once scanned, the phone gets a second window
-- of its own, ten minutes from consumed_at (HANDOFF_SESSION_MINUTES),
-- which the reader computes rather than a second column storing it,
-- because a stored second deadline could drift from consumed_at and
-- there would be no way to tell which one is authoritative. Keeping only
-- the two inputs (expires_at, consumed_at) means there is exactly one
-- source of truth per window.
--
-- One row per QR generated, not one row per signature. A signer who
-- fumbles a scan and asks for a new code gets a second row, and the
-- first is already dead rather than reused or deleted. Nothing here
-- updates or removes an old row when a new one is minted, so the full
-- history of every handoff attempt on a signature survives. "How was
-- this signature made" is a question that gets asked in a dispute, and
-- only a history of attempts, not just the winning one, can answer it.

begin;

create table if not exists public.firm_signature_handoffs (
  id uuid primary key default gen_random_uuid(),

  -- Cascades so a handoff row can never outlive the signature it
  -- authorises an action on. Deleting the signature (or a case, which
  -- cascades to its signatures) should not leave orphaned credential
  -- history behind.
  signature_id uuid not null
    references public.firm_signatures (id) on delete cascade,

  -- Only the hash is stored; see the access_code_hash precedent above.
  -- Unique because a collision would let one token unlock two handoffs.
  token_hash text not null unique,

  -- Hash of the httpOnly cookie issued to the phone that scans the QR.
  -- Null until scanned; set once, on first scan, and never rewritten.
  -- lib/signing-handoff.ts uses this to tell the phone that claimed the
  -- code apart from any other device that later presents the same URL.
  session_hash text,

  created_at timestamptz not null default now(),

  -- When the UNSCANNED code dies. Set to fifteen minutes past minting
  -- and never extended by scanning; see the two-expiries note above.
  expires_at timestamptz not null,

  -- When the phone scanned the QR and claimed the session. Null means
  -- the code is still sitting on the desktop screen, unscanned.
  consumed_at timestamptz,

  -- Captured at scan time for the dispute record described above.
  -- Neither column feeds any access decision.
  consumed_ip text,
  consumed_user_agent text,

  -- The electronic-records disclosure the signer affirmed on the LAPTOP,
  -- before this code was minted, carried across so a signature finished
  -- on the phone is recorded as completely as one finished on the
  -- laptop. Without it the QR would be the one route to a signature
  -- with a thinner record behind it than every other route, because
  -- only the desktop submit persists that capture.
  --
  -- It holds the disclosure affirmations and nothing else: no intent
  -- affirmation, no user agent, no timezone. Those describe the device
  -- that makes the mark, and the mark is made on the phone, so copying
  -- the laptop's across would assert that a device did something it did
  -- not do. lib/signing-handoff.ts validates the shape in both
  -- directions (desktopConsentForHandoff) and recombines the two
  -- sources at submit time (mergeHandoffConsent).
  --
  -- Nullable, because a row is still a valid handoff without it and a
  -- reader that finds it empty records an empty disclosure rather than
  -- inventing one.
  desktop_consent jsonb
);

-- On the foreign key, because Postgres does not index a referencing
-- column by itself. Deleting a signature (or a case, which cascades
-- through to its signatures) makes the cascade delete every child row
-- here by signature_id, and without this that is a sequential scan of
-- the whole table each time. The created_at desc tail orders one
-- signature's handoff attempts newest first, which is the order the
-- history note above is written to be read in.
--
-- No application code selects by signature_id. Every read in
-- lib/signing-handoff-queries.ts finds its row by token_hash (unique)
-- or by primary key, and the desktop poll watches firm_signatures for
-- signed_at rather than touching this table at all.
create index if not exists firm_signature_handoffs_signature_idx
  on public.firm_signature_handoffs (signature_id, created_at desc);

-- RLS is enabled with no policy at all, on purpose. Both routes that
-- touch this table run server-side against the service-role client,
-- which bypasses RLS entirely, so neither needs a policy to work. A
-- table that exists to hold hashed bearer credentials should default to
-- closed; adding a policy later would be widening access for some new
-- caller, not restoring access this table was ever meant to have.
alter table public.firm_signature_handoffs enable row level security;

commit;
