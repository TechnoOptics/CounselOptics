-- Firm-owned form templates (e.g. a configured NDA): the legal team creates
-- and publishes them; employees fill, sign, and export them from the Hub
-- portal Forms section — self-service for request types that used to become
-- tickets.
--
-- Security posture: RLS ENABLED WITH NO POLICIES. Every read/write goes
-- through service-role server actions (lib/firm-templates.ts) that gate on
-- firm membership (legal) or authorizeFirmActor (employees) — the same
-- zero-policy posture as firm_employees admin paths, so a future policy
-- mistake cannot leak another firm's templates.

create table if not exists public.firm_templates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  name text not null,
  description text,
  category text,
  -- Template body with {{field_key}} placeholders.
  body text not null,
  -- [{ key, label, type: 'text'|'date'|'textarea', required }]
  fields jsonb not null default '[]'::jsonb,
  status text not null default 'published'
    check (status in ('draft', 'published', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists firm_templates_firm_idx
  on public.firm_templates (firm_id, status);

alter table public.firm_templates enable row level security;
