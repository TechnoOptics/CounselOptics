-- Per-user dashboard customization preferences.
--
-- Shape (stored as jsonb on profiles.dashboard_preferences):
--   {
--     "counsel": { "enabled": ["action-center", "assigned-to-me", "cases-overview", ...] }
--   }
-- The "enabled" array is the ORDERED list of tile ids the user wants
-- to see on their Counsel dashboard. Tiles not in the list are hidden.
-- The renderer ignores unknown ids (so a renamed / removed tile never
-- breaks an old preferences row), and falls back to a small default
-- set (action-center + assigned-to-me) when no key is present.
--
-- Separate from profiles.menu_preferences which tracks sidebar items;
-- conceptually different surface, so they don't share a column.
--
-- Idempotent. Re-runnable.

alter table public.profiles
  add column if not exists dashboard_preferences jsonb not null default '{}'::jsonb;

comment on column public.profiles.dashboard_preferences is
  'Per-portal dashboard customization (which tiles each user enabled + order). See lib/counsel-dashboard.ts.';
