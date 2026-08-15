-- Bearer credentials for the public API.
--
-- One row per issued token for the public API at /api/v1/* and the
-- firm-scoped partner API at /api/partner/v1/*. A token looks like
-- `adv_<24 random bytes base64url>`; only its sha256 hash and its 12-char
-- prefix are stored, so the plaintext is unrecoverable from the database
-- while the dashboard can still label a row "adv_AbCd...". A row with
-- `firm_id` set is a firm integration token, and the partner API confines
-- every call made with it to that firm; `scopes` carries read / write /
-- admin, and `write` is what the partner ticket endpoints accept.
-- Revocation is `revoked_at`: set once, never cleared, row never deleted,
-- because the point of the record is that this credential existed and
-- stopped working at a known moment.
--
-- WHY THIS FILE EXISTS
--
-- public.api_tokens had no definition anywhere in this repository. It was
-- created out of band and never written down, so the only way to learn its
-- columns or its RLS posture was to query production, which a reviewer
-- cannot do. That is the same problem, and the same remedy, as
-- 2026-07-03-firm-core-rls-snapshot.sql: this file is the reference of
-- record for the table.
--
-- Everything below was read from the live database on 2026-08-15 over a
-- direct SQL connection (pg_policies, pg_indexes, pg_constraint,
-- information_schema.role_table_grants). An earlier draft of this file was
-- reconstructed over PostgREST and left three questions open because it
-- could not see policies, indexes or constraints; all three are answered
-- here, and one of the answers was a live vulnerability.
--
-- ===========================================================================
-- WHAT THE ANSWERS TURNED UP: a cross-tenant privilege escalation
-- ===========================================================================
--
-- The table carried TWO policies, not none. The second was:
--
--   api_tokens_owner_write  for all  to authenticated
--     using / with check (
--       user_id = auth.uid()
--       OR exists (select 1 from firm_members fm
--                   where fm.firm_id = api_tokens.firm_id
--                     and fm.user_id = auth.uid()
--                     and fm.role in ('owner','admin')))
--
-- `authenticated` also held INSERT on the table, there is no CHECK
-- constraint on `scopes`, and there is no trigger.
--
-- The OR is the defect. Naming yourself in `user_id` satisfies the check on
-- its own, and in that branch `firm_id` and `scopes` are unconstrained. So
-- any signed-in person could:
--
--   1. pick a plaintext, compute its sha256,
--   2. INSERT a row with user_id = their own uid, firm_id = ANY firm, and
--      scopes = ['admin'],
--   3. call /api/v1/documents with `Authorization: Bearer <plaintext>`.
--
-- verifyApiToken (lib/api-tokens.ts) looked the row up by hash and returned
-- its firm_id and scopes. /api/v1/documents, /api/v1/cases and
-- /api/v1/signing-requests then read through the SERVICE-ROLE client,
-- filtered by `.eq('firm_id', verified.firmId)` and nothing else. That is
-- another firm's documents, matters and signing requests.
--
-- FIXED 2026-08-15, in both halves:
--
--   * The policy was dropped from production:
--       drop policy api_tokens_owner_write on public.api_tokens;
--     Nothing in the product needed it. Minting (createApiToken), the bearer
--     lookup and its last_used_at touch (verifyApiToken), and revocation
--     (app/profile/api-tokens/actions.ts) all use the service-role client,
--     which bypasses RLS. The only user-scoped access is the SELECT in
--     app/profile/api-tokens/tokens-panel.tsx, which api_tokens_owner_select
--     still covers.
--
--   * verifyApiToken now re-checks that the row's user_id is a current
--     member of the row's firm_id, and refuses otherwise. Dropping a policy
--     is not a fix a test can hold: a `create policy` run next month would
--     reopen it with nothing going red. The code half is held by
--     tests/api-token-firm-binding.test.ts.
--
-- That second half also closes an ordinary case the policy had nothing to do
-- with: somebody who leaves a firm kept every token they had minted while a
-- member, because the credential outlived the membership.
--
-- STILL TRUE, and a judgement rather than a defect: api_tokens_owner_select
-- hands the token's owner, and any owner/admin of its firm, every column of
-- their own rows, `token_hash` included. A policy cannot enforce a column
-- list, so tokens-panel.tsx asking for a narrow one does not constrain a
-- crafted PostgREST request. This is not a disclosure of a usable credential:
-- the column is a sha256 of 24 random bytes and the plaintext is not
-- recoverable from it. If that surface is ever tightened, the pattern this
-- repo already reached for is a SECURITY DEFINER function with an explicit
-- column allowlist (public.get_public_tenant_firm, and the firms note in
-- 2026-07-03-firm-core-rls-snapshot.sql).
--
-- NOT APPLIED. The table already exists and the policy drop has already been
-- run, so every statement below is a no-op against production; they are here
-- so that a fresh environment and a reviewer get the same definition.
-- Regenerating supabase/schema-fingerprint.sha256 after the policy drop is
-- the repository owner's step.

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  -- Set for a firm integration token, null for a personal one.
  firm_id uuid references public.firms(id) on delete cascade,
  -- The user the token was issued to. Confirmed against auth.users; the
  -- earlier PostgREST-only draft could not see this and left it undeclared.
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  -- sha256 of the full plaintext token, hex.
  token_hash text not null unique,
  -- First 12 characters of the plaintext: `adv_` plus 8, enough to label a
  -- row without being enough to authenticate with.
  prefix text not null,
  -- read / write / admin. No default and NO CHECK CONSTRAINT in the live
  -- table: the set of legal values is enforced only by TypeScript at the
  -- mint site, which is why a row written by any other means could carry
  -- anything at all. lib/api-tokens.ts substitutes ['read'] when none given.
  scopes text[] not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  -- Set once by revokeTokenAction, never cleared.
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- The bearer lookup filters on token_hash where revoked_at is null, which is
-- exactly this partial index.
create index if not exists api_tokens_active_idx
  on public.api_tokens (token_hash) where revoked_at is null;
create index if not exists api_tokens_firm_idx
  on public.api_tokens (firm_id) where firm_id is not null;
create index if not exists api_tokens_user_idx
  on public.api_tokens (user_id) where user_id is not null;

alter table public.api_tokens enable row level security;

-- The ONE policy this table should have. A person may read the tokens they
-- hold, and an owner or admin may read the tokens bound to their firm.
-- There is deliberately no write policy: every write in the product goes
-- through the service-role client, and the one that used to exist here was
-- the escalation described above.
drop policy if exists api_tokens_owner_write on public.api_tokens;

drop policy if exists api_tokens_owner_select on public.api_tokens;
create policy api_tokens_owner_select on public.api_tokens
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.firm_members fm
      where fm.firm_id = api_tokens.firm_id
        and fm.user_id = auth.uid()
        and fm.role in ('owner', 'admin')
    )
  );

comment on table public.api_tokens is
  'Personal + firm-scoped API tokens for the public API at /api/v1/*. Tokens are hashed; we store only the prefix + hash.';
