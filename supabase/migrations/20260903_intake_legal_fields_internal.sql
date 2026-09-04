-- The legal team's own fields on a request: phase 1, the internal family.
--
-- ============================ APPLIED TO PRODUCTION 2026-09-03 ==============================
-- Applied on 2026-09-03, BEFORE the code that writes these columns was
-- merged, and verified afterwards by reading information_schema rather than
-- trusting the apply call: related_case_id (FK to cases, on delete set null),
-- completed_on and multiple_documents are present, and the seven-value
-- status CHECK is untouched. supabase/schema-fingerprint.sha256 was
-- regenerated in the same commit (to a8e96e7e), computed server side.
--
-- The ordering mattered, which is why it is recorded: the write REFUSES rather than retrying
-- without the column (setIntakeLegalFieldsAction, lib/firm-actions.ts), so
-- until this runs the Administrative tools block on a counsel ticket reads
-- every field as unset and every save says the update is pending. Reads are
-- safe either way, because the counsel page selects `*`.
--
-- Nothing in CI can contradict this banner: the schema-drift gate self-skips
-- while the SUPABASE_DB_URL repo secret is unset. Whoever applies this should
-- replace the banner with the applied date. See scripts/schema/README.md.
-- =========================================================================
--
-- WHY COLUMNS AND NOT intake_answers
--
-- One request, two audiences. app/portal/[id]/page.tsx reads the request
-- through the service-role client behind a hand-written gate, so whatever it
-- selects the employee is handed, and it selects intake_answers WHOLE. A
-- legal-only value in that jsonb ships to the employee with no code change
-- anywhere near the guard that pins the page's column list
-- (tests/employee-payload-scope.test.ts). So every field the legal team keeps
-- to itself is a column that guard can name.
--
-- WHAT IS NOT HERE, on purpose. Status, assignee, priority, due and
-- follow-up already exist (20260816_intake_workflow_state.sql and
-- intake_answers.priority). "Review follow-up date" is follow_up_on. "Close
-- notes" is intake_answers.decision.reason, written by the decline dialog and
-- read by the employee by design; a second copy would drift from the first.
-- case_id is the matter a request BECAME and is untouched; related_case_id
-- below is a matter it merely touches.

alter table public.firm_matter_intakes
  -- A matter of this firm's that the request relates to. Ownership is checked
  -- by the action before the write; the foreign key is the floor under that.
  add column if not exists related_case_id uuid references public.cases(id) on delete set null,
  -- When the legal team finished the work, as a date they set, distinct from
  -- the workflow state reaching `completed` and from updated_at.
  add column if not exists completed_on date,
  -- Whether the request covers more than one instrument. A flag the team
  -- filters by, so a column rather than a note.
  add column if not exists multiple_documents boolean not null default false;

-- No RLS change. These are columns on a table whose policies already decide
-- who may read and write the row; the app writes them only through
-- setIntakeLegalFieldsAction, which gates on lib/firm-authz.ts first, and the
-- employee's page never selects them.
