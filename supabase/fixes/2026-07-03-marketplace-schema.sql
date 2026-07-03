-- Marketplace schema (firm_leads, firm_lead_responses,
-- cocounsel_referrals), brought into source control. These tables
-- existed only in the live Supabase project. This documents the live
-- state (idempotent) so the RLS + the (lead_id, firm_id) uniqueness
-- the app relies on are reviewable.
--
-- Access model, for the record:
--   - firm_leads: consumers own their own lead row (self select/update).
--     The FIRM side reads matching leads through the service-role
--     client with app-level jurisdiction/practice-area filtering
--     (lib/marketplace-storage.ts) - deliberately no firm SELECT policy,
--     so a firm can only ever see leads the server matched to it. Lead
--     creation is also a service-role insert.
--   - firm_lead_responses: firm members read their own firm's responses;
--     writes (interest/pass/accept) go through service-role actions.
--   - cocounsel_referrals: owner/admin/attorney of either the referring
--     or referred firm can read + write.
--
-- Audit note (not enforced here): access to the marketplace is
-- membership-gated only, with no subscription-tier check. Whether it
-- should be a paid entitlement is a product decision; if it becomes
-- one, gate it server-side in the marketplace actions.

-- ---------------------------------------------------------------------
-- firm_leads (consumer-submitted matter looking for a firm)
-- ---------------------------------------------------------------------
create table if not exists firm_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  contact_email text not null,
  contact_name text,
  contact_phone text,
  jurisdiction_country text,
  jurisdiction_state text,
  jurisdiction_city text,
  practice_areas text[] not null default '{}',
  summary text not null,
  budget text,
  urgency text
    check (urgency = any (array['low','normal','high','emergency'])),
  status text not null default 'open'
    check (status = any (array['open','matched','closed','withdrawn'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists firm_leads_status_idx
  on firm_leads (status, created_at desc);
create index if not exists firm_leads_user_idx
  on firm_leads (user_id, created_at desc) where user_id is not null;

alter table firm_leads enable row level security;

drop policy if exists firm_leads_self_select on firm_leads;
create policy firm_leads_self_select
  on firm_leads for select to authenticated
  using (user_id = auth.uid());

drop policy if exists firm_leads_self_update on firm_leads;
create policy firm_leads_self_update
  on firm_leads for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- firm_lead_responses (a firm's response to a lead)
-- ---------------------------------------------------------------------
create table if not exists firm_lead_responses (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references firm_leads(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  responding_user_id uuid references auth.users(id) on delete set null,
  response_type text not null
    check (response_type = any (array['interested','pass','accepted','declined_by_user'])),
  message text,
  proposed_fee text,
  created_at timestamptz not null default now(),
  unique (lead_id, firm_id)
);

create index if not exists firm_lead_responses_firm_idx
  on firm_lead_responses (firm_id, created_at desc);

alter table firm_lead_responses enable row level security;

drop policy if exists firm_lead_responses_firm_select on firm_lead_responses;
create policy firm_lead_responses_firm_select
  on firm_lead_responses for select to authenticated
  using (
    exists (
      select 1 from firm_members
      where firm_members.firm_id = firm_lead_responses.firm_id
        and firm_members.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- cocounsel_referrals (firm-to-firm referral with fee split)
-- ---------------------------------------------------------------------
create table if not exists cocounsel_referrals (
  id uuid primary key default gen_random_uuid(),
  referring_firm_id uuid not null references firms(id) on delete cascade,
  referred_firm_id uuid not null references firms(id) on delete cascade,
  case_id uuid references cases(id) on delete set null,
  matter_summary text not null,
  proposed_split_percent integer not null
    check (proposed_split_percent >= 0 and proposed_split_percent <= 100),
  state text not null,
  status text not null default 'proposed'
    check (status = any (array['proposed','accepted','declined','closed','withdrawn'])),
  client_consent_at timestamptz,
  client_consent_audit text,
  total_fee_cents integer,
  referring_paid_cents integer not null default 0,
  referred_paid_cents integer not null default 0,
  proposed_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referring_firm_id, referred_firm_id, case_id)
);

create index if not exists cocounsel_referrals_referring_idx
  on cocounsel_referrals (referring_firm_id, status, created_at desc);
create index if not exists cocounsel_referrals_referred_idx
  on cocounsel_referrals (referred_firm_id, status, created_at desc);

alter table cocounsel_referrals enable row level security;

drop policy if exists cocounsel_referrals_member_select on cocounsel_referrals;
create policy cocounsel_referrals_member_select
  on cocounsel_referrals for select to authenticated
  using (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = any (array[cocounsel_referrals.referring_firm_id, cocounsel_referrals.referred_firm_id])
        and fm.user_id = auth.uid()
    )
  );

drop policy if exists cocounsel_referrals_member_write on cocounsel_referrals;
create policy cocounsel_referrals_member_write
  on cocounsel_referrals for all to authenticated
  using (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = any (array[cocounsel_referrals.referring_firm_id, cocounsel_referrals.referred_firm_id])
        and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney'])
    )
  )
  with check (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = any (array[cocounsel_referrals.referring_firm_id, cocounsel_referrals.referred_firm_id])
        and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney'])
    )
  );
