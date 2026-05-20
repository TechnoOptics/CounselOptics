-- Safe Witness foundation: a single profile-level contact email +
-- an audit log of every alert that fires.
--
-- The Safe Witness button on the Wear OS app (and on the web /safe
-- page) triggers an email to this contact with timestamp, the
-- voice transcription (when captured), and the watcher's identity.
-- Audio bytes are a follow-up; this migration ships the foundation.
--
-- Idempotent. Re-runnable.

alter table public.profiles
  add column if not exists safe_contact_email text;

comment on column public.profiles.safe_contact_email is
  'Email Advottic alerts when the user triggers Safe Witness on their wrist. Optional; null disables the feature.';

create table if not exists public.safe_witness_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fired_at timestamptz not null default now(),
  source text not null check (source in ('watch', 'web', 'mobile')),
  transcription text,
  contact_email text not null,
  email_sent boolean not null default false,
  email_error text,
  metadata jsonb
);

create index if not exists safe_witness_alerts_user_idx
  on public.safe_witness_alerts (user_id, fired_at desc);

comment on table public.safe_witness_alerts is
  'Audit trail for every Safe Witness alert. One row per trigger. The email is recorded as fired (email_sent true) once Resend ACKs delivery; email_error captures the failure reason otherwise.';

alter table public.safe_witness_alerts enable row level security;

create policy "safe_witness_alerts_select_own"
  on public.safe_witness_alerts
  for select
  to authenticated
  using (user_id = auth.uid());
