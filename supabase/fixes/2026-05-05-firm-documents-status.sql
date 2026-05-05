-- firm_documents: rich status workflow + case linkage tightening.
--
-- Documents are seldom signed in a vacuum - they belong to a case,
-- a matter, or a ticket. This migration:
--
--   1. Adds a status column with a checked workflow:
--        received          - incoming from external party
--        submitted         - uploaded internally, awaiting review
--        ready             - reviewed, ready to use or send
--        sent              - sent out for review or signing
--        pending           - waiting on a signer or counterparty
--        signed_internal   - executed by firm-side attorney
--        signed_employee   - signed by firm employee (HR, internal)
--        signed_client     - signed by client
--        signed_other      - signed by counterparty / opposing party
--        on_hold           - paused (deal halted, waiting on info)
--        overdue           - due_at has passed without resolution
--        canceled          - canceled
--   2. Adds due_at for overdue tracking + dashboards.
--   3. Adds description as a long-form context field.
--   4. Adds a status_updated_at column so the UI can show "last
--      moved to <status> on <date>".
--
-- The case_id FK already exists (firm_documents.case_id -> cases.id);
-- this migration leaves it alone but ensures it's indexed for the
-- "documents on this case" lookup the new UI needs.

do $$
begin
  -- status
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firm_documents'
      and column_name = 'status'
  ) then
    alter table public.firm_documents
      add column status text not null default 'submitted';
  end if;

  -- check constraint covering the workflow values
  if not exists (
    select 1 from pg_constraint
    where conname = 'firm_documents_status_check'
  ) then
    alter table public.firm_documents
      add constraint firm_documents_status_check check (status in (
        'received',
        'submitted',
        'ready',
        'sent',
        'pending',
        'signed_internal',
        'signed_employee',
        'signed_client',
        'signed_other',
        'on_hold',
        'overdue',
        'canceled'
      ));
  end if;

  -- due_at
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firm_documents'
      and column_name = 'due_at'
  ) then
    alter table public.firm_documents
      add column due_at timestamptz;
  end if;

  -- description
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firm_documents'
      and column_name = 'description'
  ) then
    alter table public.firm_documents
      add column description text;
  end if;

  -- status_updated_at
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firm_documents'
      and column_name = 'status_updated_at'
  ) then
    alter table public.firm_documents
      add column status_updated_at timestamptz not null default now();
  end if;
end $$;

-- Index on case_id for fast "documents on this case" queries.
create index if not exists firm_documents_case_idx
  on public.firm_documents (case_id, status_updated_at desc)
  where case_id is not null;

-- Index on (firm_id, status) for the dashboard "X documents pending"
-- counts and the filtered list view.
create index if not exists firm_documents_status_idx
  on public.firm_documents (firm_id, status, status_updated_at desc);

-- Index on (firm_id, due_at) so the overdue sweep is fast.
create index if not exists firm_documents_due_idx
  on public.firm_documents (firm_id, due_at)
  where due_at is not null and status not in ('signed_internal',
    'signed_employee', 'signed_client', 'signed_other', 'canceled');

comment on column public.firm_documents.status is
  'Workflow state: received | submitted | ready | sent | pending | signed_{internal,employee,client,other} | on_hold | overdue | canceled. Updated by signing-flow triggers and explicit operator action.';
comment on column public.firm_documents.due_at is
  'Optional deadline. The overdue sweep flips status to overdue when due_at passes and no signed_* / canceled state has been reached.';
comment on column public.firm_documents.description is
  'Free-form context. Visible to all firm members with read access to the document.';
