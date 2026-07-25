-- Firm policy library backing the employee "Check a document" tool: legal
-- uploads/pastes the company's policies once; employees check drafts and
-- questions against them self-service (confidence score + flagged passages)
-- instead of opening a ticket.
--
-- Same zero-policy RLS posture as firm_templates: RLS enabled, no policies,
-- all access via service-role server actions (lib/firm-policies.ts).

create table if not exists public.firm_policies (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  name text not null,
  content text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists firm_policies_firm_idx
  on public.firm_policies (firm_id);

alter table public.firm_policies enable row level security;
