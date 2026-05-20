-- Human-typeable 6-digit pairing code for the in-app watch-link flow.
--
-- The original QR-on-watch + /link-watch web flow forced a sign-in
-- roundtrip on the phone that frequently failed because of:
--   - mail-client launching a different browser than the one that
--     requested the magic link (PKCE verifier cookie missing)
--   - OAuth cross-site cookie strip on mobile (Opera mobile, Safari
--     ITP, Capacitor in-app browsers)
--
-- The new in-app /pair-watch page asks the user to type a 6-digit
-- code shown on their watch. The phone is already signed in to the
-- app, so this is one tap inside an authenticated session - no
-- second sign-in, no cookies crossing browsers, no PKCE.
--
-- The pair_code is allocated when the watch calls /api/watch/link/
-- start and is unique across active (pending) rows. The unique index
-- is partial so we don't have to clean up old rows just to free a
-- code for reuse - once a row is consumed or expired, its pair_code
-- becomes available again.
--
-- Idempotent. Re-runnable.

alter table public.watch_link_codes
  add column if not exists pair_code text;

create unique index if not exists watch_link_codes_pair_code_active_uniq
  on public.watch_link_codes (pair_code)
  where status = 'pending' and pair_code is not null;

comment on column public.watch_link_codes.pair_code is
  'Human-typeable 6-digit pairing code displayed on the Wear OS watch. The phone-app /pair-watch page accepts this as a more reliable alternative to scanning the QR + completing a sign-in roundtrip.';
