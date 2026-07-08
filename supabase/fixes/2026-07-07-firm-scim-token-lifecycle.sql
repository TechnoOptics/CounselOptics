-- SCIM provisioning token lifecycle: expiry + revocation.
--
-- Until now a firm_scim_tokens row had no way to expire or be revoked, so a
-- leaked IdP bearer token granted indefinite directory read/write over the
-- firm. Add:
--   * expires_at  - hard cutoff; authenticateScim() rejects once now() passes it.
--                   Newly issued tokens default to one year out (set in the app
--                   layer). Left NULL on the pre-existing rows so they keep
--                   working until rotated/revoked (no surprise lockout).
--   * revoked_at  - when set, the token is dead immediately. Owners/admins revoke
--                   from the SSO/SCIM settings page.
-- label and last_used_at already exist (see 2026-06-28-firm-scim-tokens.sql).
--
-- RLS stays enabled with no policies: only the service_role touches this table.

alter table public.firm_scim_tokens
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz;

-- Fast path for the auth lookup: live tokens only.
create index if not exists firm_scim_tokens_active_idx
  on public.firm_scim_tokens (token_hash)
  where revoked_at is null;
