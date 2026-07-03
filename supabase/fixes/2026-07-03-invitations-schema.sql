-- firm_invitations schema, brought into source control. The
-- token-based legal-team invite table existed only in the live
-- Supabase project, so inviteFirmMemberAction's "RLS gates the insert:
-- only owner/admin can write" comment could not be verified from the
-- repo. This documents the live state (idempotent) so that guarantee
-- is reviewable; inviteFirmMemberAction now also checks callerIsFirmAdmin
-- in code as defense in depth.

create table if not exists firm_invitations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  email text not null,
  role text not null
    check (role = any (array['owner','admin','attorney','paralegal','staff'])),
  invited_by uuid references auth.users(id) on delete set null,
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists firm_invitations_firm_idx
  on firm_invitations (firm_id);
create index if not exists firm_invitations_email_idx
  on firm_invitations (lower(email));

alter table firm_invitations enable row level security;

-- Only owner/admin of the firm may create, read, or delete invites.
-- (Accepting an invite happens in acceptFirmInvitationAction via the
-- service-role client, keyed on the token + the accepter's own email,
-- so it doesn't need an authenticated SELECT policy here.)
drop policy if exists firm_invitations_admin_select on firm_invitations;
create policy firm_invitations_admin_select
  on firm_invitations for select to authenticated
  using (
    exists (
      select 1 from firm_members me
      where me.firm_id = firm_invitations.firm_id and me.user_id = auth.uid()
        and me.role = any (array['owner','admin'])
    )
  );

drop policy if exists firm_invitations_admin_insert on firm_invitations;
create policy firm_invitations_admin_insert
  on firm_invitations for insert to authenticated
  with check (
    exists (
      select 1 from firm_members me
      where me.firm_id = firm_invitations.firm_id and me.user_id = auth.uid()
        and me.role = any (array['owner','admin'])
    )
  );

drop policy if exists firm_invitations_admin_delete on firm_invitations;
create policy firm_invitations_admin_delete
  on firm_invitations for delete to authenticated
  using (
    exists (
      select 1 from firm_members me
      where me.firm_id = firm_invitations.firm_id and me.user_id = auth.uid()
        and me.role = any (array['owner','admin'])
    )
  );
