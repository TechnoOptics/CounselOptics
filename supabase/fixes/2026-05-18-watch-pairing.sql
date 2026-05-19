-- Wear OS device-link (QR pairing) - 2026-05-18
--
-- Why this exists
-- ---------------
-- The phone<->watch Wearable Data Layer cannot bridge two separately
-- Play-distributed apps (com.advottic.app vs com.advottic.watch get
-- different Play App Signing keys, and the Data Layer only delivers
-- cross-package when the signing certs match). So the watch instead
-- syncs DIRECTLY over HTTPS: it holds an `adv_` API token and calls
-- the existing GET /api/v1/cases. This table is only the short-lived
-- handshake that gets that token onto the watch.
--
-- Flow
-- ----
--  1. Watch POST /api/watch/link/start  -> row (status=pending), shows
--     a QR of /link-watch?code=<code>.
--  2. User (already signed in on the web) opens that URL and approves;
--     POST /api/watch/link/approve mints an `adv_` read token via
--     createApiToken() and parks the plaintext here briefly.
--  3. Watch POST /api/watch/link/poll  -> once approved, returns the
--     token EXACTLY ONCE then nulls it (single-use) and marks consumed.
--
-- Security
-- --------
--  * `code` is 24 random bytes (base64url) - unguessable; it is the
--    bearer of the pairing, so HTTPS-only and a tight 10-min TTL.
--  * `issued_token` (plaintext adv_ token) is parked at rest for at
--    most the TTL, is single-use, and is nulled the instant the watch
--    reads it. This mirrors the standard OAuth device-code flow's
--    server-side hold. The token itself is independently revocable in
--    api_tokens (revoked_at) and read-scoped only.
--  * RLS is enabled with NO policies: anon/authenticated clients can
--    never touch this table. Every access goes through the
--    service-role API routes only.

create table if not exists public.watch_link_codes (
  code          text primary key,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'consumed')),
  user_id       uuid references auth.users (id) on delete cascade,
  issued_token  text,
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  expires_at    timestamptz not null
);

create index if not exists watch_link_codes_expires_idx
  on public.watch_link_codes (expires_at);

alter table public.watch_link_codes enable row level security;
-- Intentionally NO policies: service-role API routes only.

-- Optional hygiene: drop rows once well past expiry. Safe to run on a
-- schedule; the API also treats expired rows as invalid regardless.
-- delete from public.watch_link_codes where expires_at < now() - interval '1 day';
