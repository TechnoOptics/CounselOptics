-- Runtime machine-translation cache (#14). One row per (locale,
-- source string). Populated on demand by /api/i18n/translate; read back
-- to avoid re-translating (and re-paying for) the same UI string. The
-- source is keyed by a SHA-256 hash so the primary key stays small and
-- an index lookup is exact regardless of string length.
--
-- Applied to live DB via apply_migration (name: ui_translations_cache).
-- Tracked here to mirror the schema in source control.

create table if not exists public.ui_translations (
  id uuid primary key default gen_random_uuid(),
  locale text not null,
  source_hash text not null,
  source_text text not null,
  translated_text text not null,
  created_at timestamptz not null default now(),
  unique (locale, source_hash)
);

create index if not exists ui_translations_lookup
  on public.ui_translations (locale, source_hash);

-- Machine translations of UI chrome, written only by the service role
-- via the translate API. RLS on with NO public policies so PostgREST
-- exposes nothing; reads/writes go through the admin client. Mirrors
-- the "service-role-only writes" posture used for other server-managed
-- tables.
alter table public.ui_translations enable row level security;
