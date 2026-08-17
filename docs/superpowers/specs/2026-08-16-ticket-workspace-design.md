# The legal team's ticket workspace

The counsel view of an employee's request, `app/counsel/intake/[id]`, reshaped
around one rule.

**What the EMPLOYEE wrote stays in the main column. What the FIRM does about it
moves to the right rail.**

`docs/DESIGN.md` governs the look. Its "Who each surface is for" section is the
reason this is a dense, operated screen rather than a spacious read: a lawyer
opens it with a task. The accent is spent once.

---

## What the live schema actually says

Read from the live Advottic project before anything was designed.

`public.firm_matter_intakes` has `assigned_to`, `case_id`, `opposing_parties`,
`related_parties`, `conflict_results`, `client_email/phone/address`, and:

```
status text NOT NULL DEFAULT 'in_progress'
CHECK (status IN ('in_progress','conflict_check_passed','conflict_check_flagged',
                  'engaged','converted','rejected','closed'))
```

There is **no** status column holding the owner's vocabulary, **no** reminder
column, **no** due-date column and **no** follow-up column.

What does exist, in the schema-less `intake_answers` jsonb:

| key | who writes it | used by |
|---|---|---|
| `reminder_at`, `reminder_fired` | `setIntakeReminderAction` | the deadlines cron, `intakeDeadline` |
| `due_by` | the employee, as **free text** | `intakeDeadline` (parses, gives up on "end of the month") |
| `priority` | the employee | header chip, "Request details" (read only) |
| `confidentiality` | the employee | "Request details" (read only) |

So a reminder already exists and must be reused, not rebuilt. A follow-up date
does not exist. A firm-owned due date does not exist; the one that does is a
sentence an employee typed.

---

## The status problem, and why the vocabulary is not replaced

The owner asked for nine values: New, Open, Awaiting signatures, Awaiting
employee, Awaiting external party, Signed, Completed, Closed, Cancelled.

None of them is in the CHECK constraint, and the seven that are drive a lot.
Every consumer, found before proposing anything:

- `lib/intake-lanes.ts` is the single definition of what a status means. It maps
  the seven onto four lanes and is imported by `app/counsel/page.tsx`,
  `app/counsel/inbox/page.tsx`, `app/counsel/reports/page.tsx`,
  `components/counsel/IntakeInbox.tsx`, `lib/firm-actions.ts`,
  `lib/portal-open-requests.ts`, `lib/counsel-reports-data.ts`,
  `lib/approval-queue.ts`, `lib/counsel-analytics.ts`, `lib/bella.ts`.
- `lib/portal-status.ts` collapses the seven onto four employee-facing words. It
  says in writing that an unmapped status falls back to "Received", which
  "actively misinforms the requester".
- `lib/partner-tickets.ts` writes `in_progress` and returns `row.status` over
  the live partner API to an external integration.
- `app/api/cron/partner-reminders/route.ts` selects `.in('status', OPEN_STATUSES)`.

Widening the CHECK and letting the ticket page write the nine values directly
would therefore:

- park every `awaiting_*` ticket in the "Needs attention" lane forever, because
  `intakeLaneOf` sends an unrecognised status there on purpose;
- tell the employee "Received" about a ticket that is Completed;
- count Completed and Cancelled tickets as **open** on the employee's home page
  forever, which is the exact defect `lib/intake-lanes.ts` was written to fix;
- emit unknown status strings over the partner API.

**Decision: the seven-value lifecycle is not touched. A second, firm-internal
`workflow_state` column carries the nine, and every write of it also keeps the
legacy `status` in the correct lane.** Existing consumers need no change, and
the queue, the portal, the analytics and the partner API keep working.

### The mapping

`lib/intake-workflow.ts` is the single definition, in the shape
`lib/intake-lanes.ts` already established.

| workflow_state | legacy status written | lane | employee sees |
|---|---|---|---|
| `new` | (left alone) | attention | Received |
| `open` | (left alone) | attention / review | Received / In review |
| `awaiting_signatures` | `conflict_check_passed` | review | In review |
| `awaiting_employee` | `conflict_check_passed` | review | In review |
| `awaiting_external_party` | `conflict_check_passed` | review | In review |
| `signed` | `conflict_check_passed` | review | In review |
| `completed` | `closed` | closed | Closed |
| `closed` | `closed` | closed | Closed |
| `cancelled` | `closed` | closed | Closed |

Two rules keep the legacy column truthful:

1. **`converted` is never overwritten.** A converted request has a matter behind
   it. Its lifecycle has moved past intake, and a workflow state is a note about
   how the ticket is being worked, not a reason to unlink a matter.
2. **A live workflow state cannot be set on a decided request.** Picking `open`
   on a rejected ticket is refused with "Reopen this request first", because
   `reopenIntakeAction` is the path that already restores a status correctly and
   writes the reversal onto the trail.

A ticket with no `workflow_state` yet reads as a value derived from its legacy
status, so nothing renders blank: `in_progress` reads New, the three working
statuses and `converted` read Open, `rejected` and `closed` read Closed.

---

## The fields in the management block

Requested: status, set reminder, assignee, follow-up date. Two more are
proposed, and only two, each because something already in this repo is broken or
missing without it.

**Priority, made settable.** `intake_answers.priority` already exists, is drawn
as a chip in the header and listed under "Request details", and the legal team
cannot change it. Only the employee who filed the request can. An in-house team
re-prioritises constantly, and today the only record of their judgement is a
value somebody else set. No migration: the key exists.

**A firm-owned due date.** `intakeDeadline` already prefers `due_by` over the
reminder for the one date the action bar states, and `lib/intake-detail.ts`
documents that `due_by` is free text an employee typed, so "end of the month" is
normal in it. The action bar therefore has a deadline readout whose source is
frequently not a date. A real, sortable `due_on` is what an in-house counsel
manages an SLA against, and it slots in ahead of the free-text field.

Deliberately excluded, and why, rather than padding the list:

- **Confidentiality / privilege**, though `intake_answers.confidentiality`
  exists and is read-only for the same reason priority is. Making a privilege
  claim settable is a legal semantic this change should not invent. Owner's call.
- **Time, effort, budget, outside-counsel spend.** Real in-house fields with no
  schema, no consumer, and a product decision already on record that the client
  view excludes billing.
- **A separate "waiting on" field.** Redundant with the three `awaiting_*`
  states.

### Where each field is stored

| field | storage | migration |
|---|---|---|
| status | `workflow_state` (new column) | yes |
| assignee | `assigned_to` (exists) | no |
| reminder | `intake_answers.reminder_at` (exists) | no |
| follow-up date | `follow_up_on` (new column) | yes |
| due date | `due_on` (new column) | yes |
| priority | `intake_answers.priority` (exists) | no |

One migration, three columns, left **unapplied**.

---

## The three pieces

### 1. The left rail collapses, and the screen edge brings it back

A collapse state already exists and is not reinvented:
`components/counsel/SidebarFocus.tsx` holds `SidebarCollapseProvider`
(session-persisted), `useSidebarCollapse`, `RequestSidebarFocus` (a route opts
into collapse on entry and the prior state is restored on exit) and
`CounselSidebarShell` (an explicit collapse button, and a "Menu" page-keeper tab
that expands on click). `components/intake/WorkspaceShell.tsx` and the
`[data-workspace-shell]` rule at `app/globals.css` were both removed earlier
today and are not resurrected.

What is added:

- The ticket route mounts `RequestSidebarFocus`, so the rail collapses on entry
  and is restored on exit.
- A pointer-driven edge reveal, in the same module, active only while collapsed.

The edge reveal is guarded, and each guard is load bearing:

- **Fine pointers only.** `(hover: hover) and (pointer: fine)` must match, so a
  touch device never gets a trigger it cannot aim at and never loses the tab.
- **Explicit control and keyboard are the real interface.** The "Menu" tab is a
  `<button>`: reachable by Tab, activated by Enter or Space. Hover is an
  accelerator on top of it, never the only way in.
- **Not while dragging or selecting.** A move with `buttons !== 0`, or with a
  non-collapsed document selection, cancels rather than opens. Dragging a
  document to the left edge or sweeping a selection past it must not fire.
- **Dwell, then arm.** The pointer must rest in the zone briefly, and the zone
  must be armed by the pointer having been outside it at least once since the
  rail collapsed. This is what prevents the spring-back the existing code
  documents: the tab deliberately does not expand on hover because it renders
  where the cursor just was.
- **Reduced motion.** The panel already carries `motion-reduce:transition-none`,
  so the reveal arrives instantly rather than sliding. Motion drops out, it is
  not reduced.

### 2. The right rail takes the firm's operations

Moved out of the main column into the rail: **Conflict check**, **Decline or
close**, **Analyze**, **Advottic Review**, **Schedule a meeting**, and the
e-signature half of "Reminders and signatures".

The rule is applied to the rest of the page, not only to the four named things.
What the employee brought stays: the matter summary, the intake questions, the
documents, and the conversation. The rail's existing context panels stay where
they are.

The moved operations are one card of collapsible sections rather than six more
panels, using `RecordSection`, which the main column already uses and which
persists each section's state per reader.

Nothing is duplicated. The assignee select leaves the action bar for the
management block; the reminder leaves `RequestActions`, which is left holding
only the signature controls it keeps.

### 3. Accent budget

Spent once, on the action bar's primary control, which is the one thing this
screen exists to do. Demoted to reach that:

- the "In-house" chip, from `tone="accent"` to neutral;
- "Open the matter" from `text-accent-text` to a plain link;
- the reminder's and the signature's `btn-primary`, to `btn-secondary`.

Every control added by this change is secondary or a plain select.

---

## Authorization

`setIntakeWorkflowAction` is a new export of a `'use server'` module and is
therefore a public HTTP endpoint. It is gated by `lib/firm-authz.ts` with
`FIRM_MANAGE_ROLES`, the set that already decides whether the firm takes work
on, and by `requireActiveFirm`. It confirms the write with `.select('id')`,
because postgrest-js resolves a zero-row UPDATE with `error: null`.

Assignee options come from real firm membership. `assignIntakeAction` already
re-checks the target against `firm_members` server side; the option list is a
convenience, not a gate.

---

## What "done" means here

`docs/DESIGN.md` is explicit and this is not negotiable: render the page and
look at it, in both themes, at 375px, and confirm nothing but the page scrolls
sideways and the accent is spent once. Source-reading tests strip comments
before matching, and every guard is mutated to confirm it goes red.
