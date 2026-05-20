-- Multi-contact Safe Witness. Replaces the single
-- profiles.safe_contact_email with a normalized table so a user
-- can list as many contacts as they want, each with email + phone.
--
-- The PIN + message stay on profiles (shared across contacts).
-- The old profiles.safe_contact_email column is NOT dropped -
-- /api/safe/alert reads from the new table first and falls back
-- to the legacy column when the table is empty, so any user
-- already configured before this migration keeps working.
--
-- Idempotent. Re-runnable.

create table if not exists public.safe_witness_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  email text,
  phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safe_witness_contact_has_target
    check (email is not null or phone is not null)
);

create index if not exists safe_witness_contacts_user_idx
  on public.safe_witness_contacts (user_id, created_at desc);

comment on table public.safe_witness_contacts is
  'Per-user list of people Advottic alerts when the user triggers Safe Witness. Each row carries an email and/or phone; alert dispatch fans out to all configured channels for every contact.';

alter table public.safe_witness_contacts enable row level security;

create policy "safe_witness_contacts_owner_all"
  on public.safe_witness_contacts
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- One-time migration of any existing single-email Safe Witness
-- setup into the new table so users don't lose their config.
insert into public.safe_witness_contacts (user_id, email, is_primary)
select id, safe_contact_email, true
from public.profiles
where safe_contact_email is not null
on conflict do nothing;
