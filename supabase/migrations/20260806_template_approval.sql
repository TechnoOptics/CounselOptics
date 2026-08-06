-- Employee template submissions and the legal approval gate.
--
-- Before this, a completed firm template went straight out: the employee
-- filled an NDA in the Hub and emailed it to the counterparty themselves, with
-- no legal review. Now the employee submits it WITH the recipient, and the
-- document only leaves the building after someone on the legal team who may
-- release documents (owner, admin, attorney) approves it.
--
-- Where the pending state lives: on this submission record, not on the
-- template and not on the intake ticket. The template is the blank form and is
-- shared by everyone; the ticket status is a general-purpose field several
-- existing actions can already write, and reusing it would mean an unrelated
-- status write could clear a document for release. The gate needs a column
-- that only the approval path ever sets.
--
-- Trust model matches firm_templates: RLS is ON with NO policies, so nothing
-- reaches these rows except the service-role client behind server actions that
-- authorize the caller in code (lib/template-submissions.ts ->
-- lib/template-approval.ts).

-- Whether output from this template needs legal sign-off before it can be
-- sent to an outside party. Defaults to true: a form that leaves the building
-- under the firm's letterhead is reviewed unless legal says otherwise.
alter table public.firm_templates
  add column if not exists requires_approval boolean not null default true;

create table if not exists public.firm_template_submissions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- The template can be archived or replaced later; the submission keeps its
  -- own copy of the name and of the document that was actually reviewed.
  template_id uuid references public.firm_templates(id) on delete set null,
  template_name text not null,

  submitted_by uuid not null,
  submitter_name text,
  submitter_email text,

  recipient_name text,
  recipient_email text not null,
  -- Optional note the recipient sees in the delivery email.
  recipient_note text,

  -- What the employee typed, so a returned submission can be reopened
  -- prefilled instead of started over.
  field_values jsonb not null default '{}'::jsonb,
  signature_name text not null default '',
  -- The exact merged text the legal team reads and that gets rendered and
  -- sent on approval. Reviewed artifact and released artifact are one string.
  document_text text not null,

  status text not null default 'pending'
    check (status in ('pending', 'changes_requested', 'approved', 'sent', 'withdrawn')),
  -- Bumped on every resubmission so the reviewer knows they are re-reading it.
  revision int not null default 1,

  -- The approval itself. Written only by the approval path.
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,

  released_at timestamptz,
  -- Token of the encrypted share the recipient received (secure-shares/<token>).
  release_token text,
  -- Set when delivery failed after an approval, so it can be retried.
  release_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz not null default now()
);

create index if not exists firm_template_submissions_firm_idx
  on public.firm_template_submissions (firm_id, status, submitted_at desc);
create index if not exists firm_template_submissions_submitter_idx
  on public.firm_template_submissions (submitted_by, submitted_at desc);

alter table public.firm_template_submissions enable row level security;
