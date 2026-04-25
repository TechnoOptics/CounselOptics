-- Advottic Supabase schema.
-- Paste this into the Supabase SQL Editor (Dashboard → SQL Editor → "New query")
-- and run once against your project. Safe to re-run thanks to IF NOT EXISTS guards.

------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subject_name text not null,
  subject_type text not null check (subject_type in ('person', 'business', 'matter', 'state', 'entity')),
  jurisdiction_country text not null,
  jurisdiction_state text,
  jurisdiction_city text,
  case_type text not null,
  description text,
  posture text not null default 'claimant' check (posture in ('claimant', 'defendant')),
  status text not null default 'draft' check (
    status in ('draft','open','under_review','needs_evidence','export_ready','closed','archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cases
  add column if not exists posture text not null default 'claimant';

-- Allow expanded subject types on existing installs.
do $$
begin
  alter table public.cases drop constraint if exists cases_subject_type_check;
  alter table public.cases
    add constraint cases_subject_type_check
    check (subject_type in ('person', 'business', 'matter', 'state', 'entity'));
end $$;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cases_posture_check'
  ) then
    alter table public.cases
      add constraint cases_posture_check check (posture in ('claimant', 'defendant'));
  end if;
end $$;

create index if not exists cases_user_id_updated_at_idx
  on public.cases (user_id, updated_at desc);

create table if not exists public.exhibits (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  file_name text not null,
  storage_path text not null,  -- path inside the "exhibits" storage bucket
  file_type text not null,
  file_size bigint not null,
  description text,
  incident_date date,
  source text,
  category text,
  uploaded_at timestamptz not null default now()
);

-- If exhibits already existed from an earlier version, add the new metadata columns.
alter table public.exhibits
  add column if not exists incident_date date,
  add column if not exists source text,
  add column if not exists category text;

create index if not exists exhibits_case_id_uploaded_at_idx
  on public.exhibits (case_id, uploaded_at);
create index if not exists exhibits_user_id_idx
  on public.exhibits (user_id);

create table if not exists public.exhibit_plans (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,           -- "Exhibit A"
  title text not null,           -- "Pet ownership proof"
  description text,              -- what this exhibit should show
  position int not null,         -- ordinal
  filled_by_exhibit_id uuid references public.exhibits(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists exhibit_plans_case_id_position_idx
  on public.exhibit_plans (case_id, position);
create index if not exists exhibit_plans_user_id_idx
  on public.exhibit_plans (user_id);

create table if not exists public.defense_advice (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  jurisdiction text,
  charges text,
  summary text,
  pro_se_overview text,
  possible_defenses jsonb not null default '[]'::jsonb,
  procedural_posture jsonb not null default '[]'::jsonb,
  evidence_to_gather jsonb not null default '[]'::jsonb,
  when_to_hire_lawyer jsonb not null default '[]'::jsonb,
  risk_factors jsonb not null default '[]'::jsonb,
  questions_for_attorney jsonb not null default '[]'::jsonb,
  resource_topics jsonb not null default '[]'::jsonb,
  disclaimer text,
  model_used text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists defense_advice_case_id_created_at_idx
  on public.defense_advice (case_id, created_at desc);
create index if not exists defense_advice_user_id_idx
  on public.defense_advice (user_id);

create table if not exists public.case_collaborators (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor', 'attorney')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index if not exists case_collaborators_case_email_idx
  on public.case_collaborators (case_id, lower(email));
create index if not exists case_collaborators_user_id_idx
  on public.case_collaborators (user_id);
create index if not exists case_collaborators_email_idx
  on public.case_collaborators (lower(email));

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive' check (
    status in ('inactive','trialing','active','past_due','canceled','incomplete','unpaid')
  ),
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_status_idx on public.subscriptions (status);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text,                      -- e.g., "Attorney", "Client", "Case manager"
  organization text,
  avatar_url text,
  is_admin boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create table if not exists public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  jurisdiction text,
  summary text,
  timeline jsonb not null default '[]'::jsonb,
  key_facts jsonb not null default '[]'::jsonb,
  possible_issues jsonb not null default '[]'::jsonb,
  classification text,
  applicable_legal_references jsonb not null default '[]'::jsonb,
  evidence_mapping jsonb not null default '[]'::jsonb,
  evidence_to_strengthen jsonb not null default '[]'::jsonb,
  subpoena_targets jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  suggested_next_steps jsonb not null default '[]'::jsonb,
  questions_for_attorney jsonb not null default '[]'::jsonb,
  disclaimer text,
  model_used text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_reviews_case_id_created_at_idx
  on public.ai_reviews (case_id, created_at desc);
create index if not exists ai_reviews_user_id_idx
  on public.ai_reviews (user_id);

------------------------------------------------------------
-- 2. Row-Level Security
------------------------------------------------------------

alter table public.cases enable row level security;
alter table public.exhibits enable row level security;
alter table public.ai_reviews enable row level security;
alter table public.exhibit_plans enable row level security;
alter table public.defense_advice enable row level security;
alter table public.case_collaborators enable row level security;
alter table public.subscriptions enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id);
-- Inserts/updates happen via the service role from the Stripe webhook; no
-- end-user write policy.

-- cases policies
drop policy if exists "cases_select_own" on public.cases;
drop policy if exists "cases_select_own_or_collaborator" on public.cases;
create policy "cases_select_own_or_collaborator"
  on public.cases for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.case_collaborators cc
      where cc.case_id = cases.id and cc.user_id = auth.uid()
    )
  );

drop policy if exists "cases_insert_own" on public.cases;
create policy "cases_insert_own"
  on public.cases for insert
  with check (auth.uid() = user_id);

drop policy if exists "cases_update_own" on public.cases;
create policy "cases_update_own"
  on public.cases for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cases_delete_own" on public.cases;
create policy "cases_delete_own"
  on public.cases for delete
  using (auth.uid() = user_id);

-- exhibits policies
drop policy if exists "exhibits_select_own" on public.exhibits;
drop policy if exists "exhibits_select_own_or_collaborator" on public.exhibits;
create policy "exhibits_select_own_or_collaborator"
  on public.exhibits for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.case_collaborators cc
      where cc.case_id = exhibits.case_id and cc.user_id = auth.uid()
    )
  );

-- Owner OR a collaborator with role editor/attorney can add exhibits to a case.
-- The exhibit row's user_id is whoever uploaded it (could be the collaborator),
-- so RLS validates against case ownership / collaboration, not user_id.
drop policy if exists "exhibits_insert_own" on public.exhibits;
drop policy if exists "exhibits_insert_owner_or_editor" on public.exhibits;
create policy "exhibits_insert_owner_or_editor"
  on public.exhibits for insert
  with check (
    auth.uid() = user_id
    and (
      exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
      or exists (
        select 1 from public.case_collaborators cc
        where cc.case_id = exhibits.case_id
          and cc.user_id = auth.uid()
          and cc.role in ('editor', 'attorney')
      )
    )
  );

drop policy if exists "exhibits_delete_own" on public.exhibits;
drop policy if exists "exhibits_delete_uploader_or_owner" on public.exhibits;
create policy "exhibits_delete_uploader_or_owner"
  on public.exhibits for delete
  using (
    auth.uid() = user_id
    or exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
  );

-- ai_reviews policies
drop policy if exists "ai_reviews_select_own" on public.ai_reviews;
drop policy if exists "ai_reviews_select_own_or_collaborator" on public.ai_reviews;
create policy "ai_reviews_select_own_or_collaborator"
  on public.ai_reviews for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.case_collaborators cc
      where cc.case_id = ai_reviews.case_id and cc.user_id = auth.uid()
    )
  );

drop policy if exists "ai_reviews_insert_own" on public.ai_reviews;
create policy "ai_reviews_insert_own"
  on public.ai_reviews for insert
  with check (auth.uid() = user_id);

-- exhibit_plans policies
drop policy if exists "exhibit_plans_select_own" on public.exhibit_plans;
drop policy if exists "exhibit_plans_select_own_or_collaborator" on public.exhibit_plans;
create policy "exhibit_plans_select_own_or_collaborator"
  on public.exhibit_plans for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.case_collaborators cc
      where cc.case_id = exhibit_plans.case_id and cc.user_id = auth.uid()
    )
  );

drop policy if exists "exhibit_plans_insert_own" on public.exhibit_plans;
create policy "exhibit_plans_insert_own"
  on public.exhibit_plans for insert
  with check (auth.uid() = user_id);

drop policy if exists "exhibit_plans_update_own" on public.exhibit_plans;
create policy "exhibit_plans_update_own"
  on public.exhibit_plans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "exhibit_plans_delete_own" on public.exhibit_plans;
create policy "exhibit_plans_delete_own"
  on public.exhibit_plans for delete
  using (auth.uid() = user_id);

-- defense_advice policies
drop policy if exists "defense_advice_select_own" on public.defense_advice;
drop policy if exists "defense_advice_select_own_or_collaborator" on public.defense_advice;
create policy "defense_advice_select_own_or_collaborator"
  on public.defense_advice for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.case_collaborators cc
      where cc.case_id = defense_advice.case_id and cc.user_id = auth.uid()
    )
  );

drop policy if exists "defense_advice_insert_own" on public.defense_advice;
create policy "defense_advice_insert_own"
  on public.defense_advice for insert
  with check (auth.uid() = user_id);

-- case_collaborators policies — only the case owner manages.
drop policy if exists "case_collaborators_select" on public.case_collaborators;
create policy "case_collaborators_select"
  on public.case_collaborators for select
  using (
    exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
    or user_id = auth.uid()
  );

drop policy if exists "case_collaborators_insert" on public.case_collaborators;
create policy "case_collaborators_insert"
  on public.case_collaborators for insert
  with check (
    exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
    and invited_by = auth.uid()
  );

drop policy if exists "case_collaborators_delete" on public.case_collaborators;
create policy "case_collaborators_delete"
  on public.case_collaborators for delete
  using (
    exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
  );

-- profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cases_set_updated_at on public.cases;
create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

-- Auto-create a profiles row whenever a new user signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.email
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  -- Convert any pending invites that match this user's email into accepted collaborator rows.
  update public.case_collaborators
  set user_id = new.id, accepted_at = now()
  where lower(email) = lower(new.email) and user_id is null;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------
-- 4. Storage bucket for exhibits
------------------------------------------------------------
-- NOTE: the `storage` schema exists in every Supabase project.

insert into storage.buckets (id, name, public)
  values ('exhibits', 'exhibits', false)
  on conflict (id) do nothing;

-- Storage policies: paths are "<uploader_user_id>/<case_id>/<file>".
-- Read: uploader OR case owner OR collaborator on that case.
-- Insert: uploader (auth.uid()) AND (owner of case OR editor/attorney collaborator).
-- Delete: uploader OR case owner.
drop policy if exists "exhibits_storage_select_own" on storage.objects;
drop policy if exists "exhibits_storage_select" on storage.objects;
create policy "exhibits_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'exhibits'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.cases c
        where c.id::text = (storage.foldername(name))[2]
          and c.user_id = auth.uid()
      )
      or exists (
        select 1 from public.case_collaborators cc
        where cc.case_id::text = (storage.foldername(name))[2]
          and cc.user_id = auth.uid()
      )
    )
  );

drop policy if exists "exhibits_storage_insert_own" on storage.objects;
drop policy if exists "exhibits_storage_insert" on storage.objects;
create policy "exhibits_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'exhibits'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      exists (
        select 1 from public.cases c
        where c.id::text = (storage.foldername(name))[2]
          and c.user_id = auth.uid()
      )
      or exists (
        select 1 from public.case_collaborators cc
        where cc.case_id::text = (storage.foldername(name))[2]
          and cc.user_id = auth.uid()
          and cc.role in ('editor', 'attorney')
      )
    )
  );

drop policy if exists "exhibits_storage_delete_own" on storage.objects;
drop policy if exists "exhibits_storage_delete" on storage.objects;
create policy "exhibits_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'exhibits'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.cases c
        where c.id::text = (storage.foldername(name))[2]
          and c.user_id = auth.uid()
      )
    )
  );
