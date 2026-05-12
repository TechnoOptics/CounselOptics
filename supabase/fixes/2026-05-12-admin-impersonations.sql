-- Audit log for HQ admin impersonation events.
-- Powers /api/admin/impersonate, which writes one row per
-- "sign in as user" action triggered from /admin/users.
--
-- Idempotent. Re-runnable.

create table if not exists public.admin_impersonations (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete restrict,
  admin_email text,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  target_email text not null,
  reason text,
  user_agent text,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists admin_impersonations_admin_id_idx
  on public.admin_impersonations (admin_id, created_at desc);
create index if not exists admin_impersonations_target_id_idx
  on public.admin_impersonations (target_user_id, created_at desc);

-- Service-role write only. No direct reads from the API; review via
-- SQL Editor in the Supabase dashboard.
alter table public.admin_impersonations enable row level security;

comment on table public.admin_impersonations is
  'Every "Sign in as user" action triggered from /admin/users. Service-role write only; review via Supabase SQL Editor. See /api/admin/impersonate.';
comment on column public.admin_impersonations.reason is
  'Optional free-text reason supplied by the admin at impersonation time. Best practice: ticket ID + one-line summary.';
