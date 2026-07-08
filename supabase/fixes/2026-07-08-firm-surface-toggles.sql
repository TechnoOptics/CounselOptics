-- Per-firm surface toggles: let a firm owner/admin hide whole surfaces
-- of the Counsel workspace they do not use.
--
-- Both live on the existing per-firm flags table firm_settings (added in
-- 2026-07-08-recurring-faces.sql). They are plain feature flags, OFF by
-- default, so every existing firm keeps its current experience until an
-- admin explicitly turns a surface off.
--
--   hide_search        - hides the global "Ask Advottic" search box that
--                        sits at the top of Counsel pages.
--   hide_time_billing  - hides the Time & Billing group (Time, Billing,
--                        Trust) from the sidebar + mobile nav, and blocks
--                        those routes for the firm.
--
-- Reads: lib/firm-settings.ts (member-select is enough - any member can
-- read their firm's flags). Writes: lib/firm-settings-actions.ts, gated to
-- owner/admin (the firm_settings_admin_write policy already enforces this).

alter table public.firm_settings
  add column if not exists hide_search boolean not null default false;

alter table public.firm_settings
  add column if not exists hide_time_billing boolean not null default false;

-- NOTE: after applying this migration to the live DB, regenerate the schema
-- fingerprint or CI (schema-drift gate) will fail:
--   psql "$SUPABASE_DB_URL" -X -q -t -A -f scripts/schema/fingerprint-hash.sql \
--     | tr -d '[:space:]' > supabase/schema-fingerprint.sha256
