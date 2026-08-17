-- The legal team's own view of how a ticket is going.
--
-- NOT a replacement for firm_matter_intakes.status. That column's CHECK
-- constraint over seven values is read by lib/intake-lanes.ts (the queue
-- lanes), lib/portal-status.ts (what the employee is told),
-- lib/partner-tickets.ts (a live external API), the partner-reminders cron and
-- lib/portal-open-requests.ts (the employee's "N requests open"). Widening it
-- to carry the nine values below would have parked every awaiting_* ticket in
-- the "Needs attention" lane forever, because intakeLaneOf sends an
-- unrecognised status there on purpose.
--
-- So this is additive. lib/intake-workflow.ts holds the mapping, and every
-- write of workflow_state also keeps `status` in the correct lane.
--
-- NO REMINDER COLUMN. A reminder already exists at
-- intake_answers.reminder_at, is written by setIntakeReminderAction and is
-- swept by the deadlines cron. A second one would be a second answer to the
-- same question and the two would drift.

alter table public.firm_matter_intakes
  add column if not exists workflow_state text,
  -- The date the legal team means to look at this again. Distinct from the
  -- reminder, which fires a notification; this is a queue field somebody
  -- filters and sorts by, which is why it is a column rather than another key
  -- in the schema-less answers blob.
  add column if not exists follow_up_on date,
  -- The firm's own commitment date. intake_answers.due_by already exists but
  -- is FREE TEXT an employee typed ("end of the month"), which
  -- lib/intake-detail.ts documents and works around. A real date is what an
  -- in-house team manages an SLA against.
  add column if not exists due_on date;

-- Null is a legal value and means nobody has set one yet. Existing rows keep
-- reading through the derivation in lib/intake-workflow.ts rather than being
-- backfilled into a state no person chose.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'firm_matter_intakes_workflow_state_check'
  ) then
    alter table public.firm_matter_intakes
      add constraint firm_matter_intakes_workflow_state_check
      check (
        workflow_state is null
        or workflow_state = any (array[
          'new',
          'open',
          'awaiting_signatures',
          'awaiting_employee',
          'awaiting_external_party',
          'signed',
          'completed',
          'closed',
          'cancelled'
        ]::text[])
      );
  end if;
end $$;

-- The two queue reads these columns exist to serve: "what is on my desk this
-- week" and "what is overdue". Partial, because a null date is the ordinary
-- case and indexing it would be indexing most of the table for nothing.
create index if not exists firm_matter_intakes_follow_up_on_idx
  on public.firm_matter_intakes (firm_id, follow_up_on)
  where follow_up_on is not null;

create index if not exists firm_matter_intakes_due_on_idx
  on public.firm_matter_intakes (firm_id, due_on)
  where due_on is not null;

-- No RLS change. These are columns on a table whose policies already decide
-- who may read and write the row, and every write from the app goes through
-- setIntakeWorkflowAction, which gates on lib/firm-authz.ts first.
