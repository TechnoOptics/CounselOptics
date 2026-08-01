-- Billing schema (firm_invoices + firm_time_entries), brought into
-- source control. These tables existed only in the live Supabase
-- project, so their RLS and constraints were not reviewable in the
-- repo - the enterprise audit repeatedly flagged this on the money
-- surface. This file documents the current live state and is
-- idempotent (CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS), so it
-- can be applied to a fresh branch without disturbing production.
--
-- Verified authorization posture (this is what the audit's "cross-
-- tenant invoice IDOR" concern actually resolves to, once the policy
-- is visible): invoice writes require an owner/admin/attorney member
-- of the invoice's firm; a client can read only their own invoice.
-- The app-layer actions add the same check as defense in depth.

-- ---------------------------------------------------------------------
-- firm_invoices
-- ---------------------------------------------------------------------
create table if not exists firm_invoices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  case_id uuid references cases(id) on delete set null,
  client_user_id uuid references auth.users(id) on delete set null,
  client_email text not null,
  client_name text,
  number text not null,
  status text not null default 'draft'
    check (status = any (array['draft','sent','paid','void'])),
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'USD',
  notes text,
  due_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  stripe_payment_intent_id text,
  stripe_payment_link text,
  -- The plink_ ID behind stripe_payment_link. Added
  -- 2026-08-01; a payment link stays payable until it is explicitly
  -- deactivated, and deactivating one needs this ID (the buy.stripe.com
  -- URL does not contain it). See
  -- supabase/migrations/20260801_firm_invoice_payment_link_id.sql.
  stripe_payment_link_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists firm_invoices_number_idx
  on firm_invoices (firm_id, number);
create index if not exists firm_invoices_status_idx
  on firm_invoices (firm_id, status, created_at desc);

alter table firm_invoices enable row level security;

drop policy if exists firm_invoices_member_select on firm_invoices;
create policy firm_invoices_member_select
  on firm_invoices for select to authenticated
  using (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_invoices.firm_id and fm.user_id = auth.uid()
    )
    or client_user_id = auth.uid()
  );

drop policy if exists firm_invoices_member_write on firm_invoices;
create policy firm_invoices_member_write
  on firm_invoices for all to authenticated
  using (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_invoices.firm_id and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney'])
    )
  )
  with check (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_invoices.firm_id and fm.user_id = auth.uid()
        and fm.role = any (array['owner','admin','attorney'])
    )
  );

-- ---------------------------------------------------------------------
-- firm_time_entries
-- ---------------------------------------------------------------------
-- An entry is immutable once invoiced: the write policy's USING clause
-- requires invoice_id IS NULL, so a member can only edit/delete an
-- entry while it is not yet on an invoice. WITH CHECK stays
-- unconstrained on invoice_id so buildDraftInvoiceAction's stamp
-- (null -> set) still works. See
-- 2026-07-03-time-entry-invoice-immutability.sql.
create table if not exists firm_time_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid references cases(id) on delete set null,
  document_id uuid references firm_documents(id) on delete set null,
  description text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  billable boolean not null default true,
  rate_cents integer,
  invoice_id uuid references firm_invoices(id) on delete set null,
  source text not null default 'manual'
    check (source = any (array['manual','bella','document','chat','calendar'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists firm_time_entries_firm_user_idx
  on firm_time_entries (firm_id, user_id, started_at desc);
create index if not exists firm_time_entries_case_idx
  on firm_time_entries (case_id, started_at desc) where case_id is not null;
create index if not exists firm_time_entries_open_idx
  on firm_time_entries (firm_id, user_id) where ended_at is null;

alter table firm_time_entries enable row level security;

drop policy if exists firm_time_entries_member_select on firm_time_entries;
create policy firm_time_entries_member_select
  on firm_time_entries for select to authenticated
  using (
    exists (
      select 1 from firm_members
      where firm_members.firm_id = firm_time_entries.firm_id
        and firm_members.user_id = auth.uid()
    )
  );

drop policy if exists firm_time_entries_self_write on firm_time_entries;
create policy firm_time_entries_self_write
  on firm_time_entries for all to authenticated
  using (
    user_id = auth.uid()
    and invoice_id is null
    and exists (
      select 1 from firm_members
      where firm_members.firm_id = firm_time_entries.firm_id
        and firm_members.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from firm_members
      where firm_members.firm_id = firm_time_entries.firm_id
        and firm_members.user_id = auth.uid()
    )
  );
