-- 2026-07-04: Public tenant branding via SECURITY DEFINER RPC.
--
-- Fixes the review item flagged in 2026-07-03-firm-core-rls-snapshot.sql:
--
--   firms_public_tenant_select was `USING (subdomain_enabled = true)` for
--   anon/authenticated. It exists so a public tenant subdomain
--   (<slug>.advottic.com) can read a firm's branding before login - but a
--   table-level SELECT policy exposes EVERY column of any subdomain-enabled
--   firm to anonymous readers, including internal fields: token_pool_balance,
--   created_by, and the whole metadata jsonb (industry, menu config, etc.).
--   Verified against live data 2026-07-04: those three columns were readable
--   by anon. Worse, any column added to `firms` later would leak by default.
--
-- Fix: mirror the community-page pattern (get_public_community_case) - a
-- SECURITY DEFINER function with an EXPLICIT column allowlist is the only
-- public read path, and the permissive table policy is dropped so internal
-- columns can never leak by accident again. Adding a sensitive column to
-- `firms` no longer exposes it - someone has to consciously add it to the
-- SELECT list below.
--
-- brand_name is surfaced from metadata->>'brandName' only (the single public
-- branding key); the rest of the metadata bag stays private. `id` is included
-- because the subdomain resolver needs the tenant firm id to build request
-- context headers - it is a random uuid tenant handle, not a sensitive field.
--
-- STATUS: Steps 1-2 (RPC + grants) APPLIED to live prod (hpmtlhpyvbreyfimftgt)
-- on 2026-07-04 via the Supabase migration tool and verified through the anon
-- key. Step 3 (DROP POLICY) is PENDING the frontend deploy - zinpro.advottic.com
-- was confirmed serving HTTP 200 in prod off the old direct-read path, so
-- dropping the policy before lib/firm-cache.ts ships would 404 that live tenant.
--
-- APPLY ORDER (important): the RPC + grant (steps 1-2) are additive and safe
-- to apply any time - the old policy keeps working until it is dropped, so
-- existing production traffic is unaffected. The DROP POLICY (step 3) removes
-- the direct-table read path, so it MUST be applied only AFTER the frontend
-- that calls get_public_tenant_firm() (lib/firm-cache.ts) is deployed to
-- production. Dropping it while the old middleware (direct `.from('firms')`
-- select) is still live would 404 every tenant subdomain.

------------------------------------------------------------
-- 1. Public read RPC (explicit column allowlist)
------------------------------------------------------------
create or replace function public.get_public_tenant_firm(_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  accent_color text,
  logo_url text,
  letterhead_url text,
  subdomain_enabled boolean,
  brand_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    f.id,
    f.slug,
    f.name,
    f.accent_color,
    f.logo_url,
    f.letterhead_url,
    f.subdomain_enabled,
    nullif(f.metadata->>'brandName', '') as brand_name
  from public.firms f
  where lower(f.slug) = lower(_slug)
    and f.subdomain_enabled = true;
$$;

------------------------------------------------------------
-- 2. Grants (anon can read; public role cannot)
------------------------------------------------------------
revoke execute on function public.get_public_tenant_firm(text) from public;
grant execute on function public.get_public_tenant_firm(text) to anon, authenticated;

------------------------------------------------------------
-- 3. Drop the permissive table-level SELECT policy
--    APPLY ONLY AFTER the RPC-based frontend is deployed (see header).
------------------------------------------------------------
drop policy if exists firms_public_tenant_select on public.firms;
