-- Vault + Contracts folders (consumer libraries).
--
-- A folder is a per-user label scoped to one surface: 'vault' (receipts)
-- or 'contract'. Receipts/contracts carry a nullable folder_id. Deleting a
-- folder leaves its items in place (folder_id falls back to NULL via the
-- FK on delete set null) so nothing a user uploaded is ever lost.
--
-- Additive + idempotent: safe to run against the live database.

create table if not exists public.vault_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('vault', 'contract')),
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists vault_folders_user_kind_idx
  on public.vault_folders (user_id, kind, created_at);

alter table public.vault_folders enable row level security;

drop policy if exists "vault_folders_select_own" on public.vault_folders;
create policy "vault_folders_select_own"
  on public.vault_folders for select
  using (auth.uid() = user_id);

drop policy if exists "vault_folders_modify_own" on public.vault_folders;
create policy "vault_folders_modify_own"
  on public.vault_folders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.user_receipts
  add column if not exists folder_id uuid
  references public.vault_folders(id) on delete set null;

alter table public.user_contracts
  add column if not exists folder_id uuid
  references public.vault_folders(id) on delete set null;
