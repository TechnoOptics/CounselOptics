-- Employee portal roles / groups - 2026-05-19
--
-- An enterprise admin defines named roles (a.k.a. groups) in
-- firms.metadata.portalRoles - each role is { key, name, features[] }
-- where features are portal capability keys (see lib/portal-features.ts).
-- An employee is assigned ONE role via this column; their portal
-- entitlements are that role's feature set. No role -> a sensible
-- default base set. Roles gradually unlock more of the portal.
--
-- Role DEFINITIONS live in metadata (no schema needed, edited by the
-- admin UI). Only the per-employee ASSIGNMENT needs a real column so
-- it is queryable and survives metadata edits. Nullable + free text:
-- a role that is later deleted simply falls back to the default set
-- (resolveEntitlements treats an unknown key as "no role").

alter table public.firm_employees
  add column if not exists role_key text;
