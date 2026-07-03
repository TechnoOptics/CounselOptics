-- Firm projects: a named workspace a firm can open, fill with named
-- folders, and drop notes + documents into for later retrieval, with
-- an archive so nothing is lost. Any legal-team member of the firm can
-- use them; writes go through the RLS-scoped client.

create table if not exists firm_projects (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status = any (array['active','archived'])),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists firm_projects_firm_idx
  on firm_projects (firm_id, status, updated_at desc);

create table if not exists firm_project_folders (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  project_id uuid not null references firm_projects(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists firm_project_folders_project_idx
  on firm_project_folders (project_id, created_at);

create table if not exists firm_project_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  project_id uuid not null references firm_projects(id) on delete cascade,
  -- null folder_id = item lives at the project root.
  folder_id uuid references firm_project_folders(id) on delete cascade,
  kind text not null check (kind = any (array['note','document'])),
  title text not null,
  note_body text,
  storage_path text,
  file_name text,
  file_size integer,
  file_type text,
  archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists firm_project_items_project_idx
  on firm_project_items (project_id, archived, created_at desc);
create index if not exists firm_project_items_folder_idx
  on firm_project_items (folder_id, archived, created_at desc) where folder_id is not null;

alter table firm_projects enable row level security;
alter table firm_project_folders enable row level security;
alter table firm_project_items enable row level security;

drop policy if exists firm_projects_member on firm_projects;
create policy firm_projects_member on firm_projects for all to authenticated
  using (exists (select 1 from firm_members fm where fm.firm_id = firm_projects.firm_id and fm.user_id = auth.uid()))
  with check (exists (select 1 from firm_members fm where fm.firm_id = firm_projects.firm_id and fm.user_id = auth.uid()));

drop policy if exists firm_project_folders_member on firm_project_folders;
create policy firm_project_folders_member on firm_project_folders for all to authenticated
  using (exists (select 1 from firm_members fm where fm.firm_id = firm_project_folders.firm_id and fm.user_id = auth.uid()))
  with check (exists (select 1 from firm_members fm where fm.firm_id = firm_project_folders.firm_id and fm.user_id = auth.uid()));

drop policy if exists firm_project_items_member on firm_project_items;
create policy firm_project_items_member on firm_project_items for all to authenticated
  using (exists (select 1 from firm_members fm where fm.firm_id = firm_project_items.firm_id and fm.user_id = auth.uid()))
  with check (exists (select 1 from firm_members fm where fm.firm_id = firm_project_items.firm_id and fm.user_id = auth.uid()));
