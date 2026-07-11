-- Firm-provisioned scoped GUEST accounts for co-counsel / outside collaborators.
--
-- Background. A firm can already invite co-counsel to a single matter by email
-- (case_collaborators role 'attorney'); that person self-signs-up with a magic
-- link and gets a strictly case-scoped Counsel view (lib/persona.ts ->
-- 'counsel_guest', lib/counsel-guest.ts). This table adds the OTHER onboarding
-- path: a firm owner/admin creates the guest DIRECTLY from the matter's People
-- panel with a username + a temporary password the guest must change on first
-- login. The identity is FIRM-OWNED and kept separate from any personal
-- Advottic account the same person might self-sign-up for - we deliberately do
-- NOT merge by email (the auth user is minted with a synthetic, firm-namespaced
-- email so it never collides with a real inbox).
--
--   * user_id                - the minted auth.users row (1:1 with a guest).
--   * firm_id                - the firm that OWNS this guest identity.
--   * username               - the human-facing login handle the firm chose.
--   * must_change_password   - true until the guest completes the force-change
--                              flow on first login (lib/guest-account-actions.ts
--                              clears it). The Counsel layout parks a guest with
--                              this flag on /counsel/guest/password.
--   * deactivated_at         - non-null => access is cut INSTANTLY. The persona
--                              resolver treats a deactivated guest as no-access,
--                              so revoking is a single UPDATE with no cache to
--                              wait on.
--
-- Access model. Like the rest of the firm surface, firm members are not case
-- members, so every read/write of this table goes through the ADMIN client
-- gated on firm membership in application code (lib/guest-account-actions.ts).
-- RLS is the safe default below: a guest may read ONLY their own row (so the
-- force-change page can show their handle); all writes are service-role only.

create table if not exists public.firm_guest_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  -- Login handle uniqueness is scoped per firm (two firms may each have a
  -- "jsmith" guest); the auth email carries the global uniqueness.
  created_by uuid references auth.users(id) on delete set null,
  must_change_password boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One guest identity per auth user (the auth user IS the guest).
create unique index if not exists firm_guest_accounts_user_id_key
  on public.firm_guest_accounts (user_id);

-- Username is unique within a firm.
create unique index if not exists firm_guest_accounts_firm_username_key
  on public.firm_guest_accounts (firm_id, lower(username));

create index if not exists firm_guest_accounts_firm_id_idx
  on public.firm_guest_accounts (firm_id);

alter table public.firm_guest_accounts enable row level security;

-- A guest may read their own row (needed by the force-change page + the guest
-- shell). Nobody reads other guests' rows through RLS - the firm-side listing
-- goes through the admin client gated on firm membership.
drop policy if exists firm_guest_accounts_self_select on public.firm_guest_accounts;
create policy firm_guest_accounts_self_select on public.firm_guest_accounts
  for select to authenticated
  using (user_id = auth.uid());

-- No authenticated INSERT/UPDATE/DELETE policy: all writes are service-role
-- only (admin client bypasses RLS), matching the firm-case write pattern.

comment on table public.firm_guest_accounts is
  'Firm-owned, case-scoped guest identities (co-counsel / outside collaborators) created with a temp password. Access cut instantly via deactivated_at. See lib/guest-account-actions.ts + lib/persona.ts.';
