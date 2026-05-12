-- Per-user sidebar customization preferences.
--
-- Shape (stored as jsonb on profiles.menu_preferences):
--   {
--     "consumer": { "hidden": ["billing", "vault"], "order": ["new-case","cases","find-counsel",...] },
--     "counsel":  { "hidden": [...], "order": [...] }
--   }
-- Each portal namespace is optional; missing portals fall back to
-- the component-default order with no items hidden.
--
-- Identifiers are stable strings owned by the sidebar component
-- (we use the href as the id). Reordering or hiding an item the
-- user doesn't know about is harmless: the renderer ignores
-- entries that aren't in the master list.
--
-- Idempotent. Re-runnable.

alter table public.profiles
  add column if not exists menu_preferences jsonb not null default '{}'::jsonb;

comment on column public.profiles.menu_preferences is
  'Per-portal sidebar customization (hidden items + custom order). See lib/menu-prefs.ts.';
