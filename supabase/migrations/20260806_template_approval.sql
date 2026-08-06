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
--
-- APPLY THIS IN THE SAME WINDOW AS THE MERGE. IT CANNOT TRAIL THE DEPLOY.
--
-- This file has never been run, so the decline state and the reviewer-edit
-- columns were folded into it rather than added as a second migration. If any
-- environment has already applied an earlier copy of this file, run the
-- catch-up block at the bottom instead of re-running the whole thing.
--
-- The employee Forms surface does not degrade gracefully without it, it stops
-- working. `requires_approval` is absent from the row until this runs, and the
-- reader treats absent as "needs review" (the safe direction, but the costly
-- one here): every published template renders as gated, so Download and Print
-- are hidden, and Send to legal then fails because firm_template_submissions
-- does not exist. Saving a template from the counsel side fails too, because
-- the insert names a column the table does not yet have. Deploy and migrate
-- together, or migrate first.

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

  -- 'declined' is its own terminal state and not a flavour of
  -- 'changes_requested'. A returned submission is still alive and the employee
  -- is expected to fix it; a declined one is finished and nothing reopens it.
  status text not null default 'pending'
    check (status in ('pending', 'changes_requested', 'approved', 'sent', 'withdrawn', 'declined')),
  -- Bumped on every resubmission so the reviewer knows they are re-reading it.
  revision int not null default 1,

  -- The approval itself. Written only by the approval path.
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,

  -- The reviewer's edit, when there was one.
  --
  -- document_text always holds what would actually be released, so the sent
  -- document is the edited one. The employee's own text is copied in here on
  -- the FIRST edit and never touched again, so the audit trail can always
  -- answer "what did the employee actually submit" separately from "what did
  -- counsel send". Null on both columns means the released document is the
  -- employee's own words, unaltered.
  original_document_text text,
  edited_by uuid,
  edited_at timestamptz,
  edit_note text,

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

-- Catch-up, for an environment that applied an earlier copy of this file
-- before 'declined' and the reviewer-edit columns existed. All no-ops on a
-- fresh database, where the create table above already covers them.
alter table public.firm_template_submissions
  add column if not exists original_document_text text,
  add column if not exists edited_by uuid,
  add column if not exists edited_at timestamptz,
  add column if not exists edit_note text;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.firm_template_submissions'::regclass
      and conname = 'firm_template_submissions_status_check'
      and pg_get_constraintdef(oid) not like '%declined%'
  ) then
    alter table public.firm_template_submissions
      drop constraint firm_template_submissions_status_check;
    alter table public.firm_template_submissions
      add constraint firm_template_submissions_status_check
      check (status in ('pending', 'changes_requested', 'approved', 'sent', 'withdrawn', 'declined'));
  end if;
end $$;
