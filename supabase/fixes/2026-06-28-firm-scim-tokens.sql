-- SCIM 2.0 provisioning tokens, one or more per firm.
-- Tokens are stored only as a sha256 hash; the plaintext is shown once at
-- creation and pasted into the firm's IdP (Entra ID / Okta). RLS is enabled
-- with NO policies on purpose: only the service_role (used by the SCIM route
-- handlers in app/api/scim/v2/*) may read or write this table. No firm user,
-- even an owner, can read another firm's token hashes through the API.

create table if not exists public.firm_scim_tokens (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists firm_scim_tokens_firm_idx
  on public.firm_scim_tokens (firm_id);

alter table public.firm_scim_tokens enable row level security;
-- Intentionally no policies: service_role only.
