# Advottic Review is optional when an employee files a ticket

Date: 2026-08-06
Status: approved

## Problem

An employee filing a request through the portal (`/portal/new`) cannot
submit it if they attach a document, unless they first run Advottic
Review on that document and it grades C or higher. The block lives in
`app/counsel/intake/create-intake-form.tsx`, in the submit handler:

- No scorecard yet: "Run Advottic Review on your attached document
  before submitting."
- Scorecard exists but `passes` is false: "This document graded X. Apply
  the suggested revisions and re-run the review, a C or higher is
  required to submit."

An employee attaching a counterparty's draft contract is the ordinary
case, and that draft is exactly the kind of document that grades badly.
The gate stops them handing the problem to legal, which is the reason
they opened the ticket.

## Decision

Advottic Review stays available to employees and stops being mandatory.

- Nothing blocks submission on an employee ticket.
- The "Run Advottic Review" button stays. An employee who wants the read
  can still get it.
- If they run it, the scorecard is still written to
  `intake_answers.review`, so legal still sees the panel on the ticket
  (`app/counsel/intake/[id]/page.tsx`).
- The legal team's own intake form, the same component without
  `employeeMode`, is unchanged and keeps the gate.

## Scope of "an employee"

`CreateIntakeForm` already takes an `employeeMode` prop, and
`app/portal/new/page.tsx` is its only caller. That page redirects
anything that is not an `employee` persona, so the prop is an exact
match for "an employee is creating a ticket". No new plumbing is needed
to identify the case.

`employeeMode` already carries three behaviours: outside-client request
types are filtered out, "Submitted by" is locked to the signed-in
employee, and every request is treated as in-house. Making the review
optional joins that set rather than arriving as a second flag.

A separate `reviewRequired` prop was considered and rejected. It would
have exactly one caller and no second use case in view. The pure
function below is where a per-firm setting would plug in if one is ever
wanted.

## Design

### 1. `lib/intake-review-gate.ts` (new)

A plain module, no `'use server'` directive and no dependencies:

```ts
resolveIntakeReviewGate({ filesAttached, reviewRequired, scorecard })
  -> { blocked: boolean; reason: 'not-run' | 'failing-grade' | null; attachReview: boolean }
```

It exists so the decision can be tested. Vitest runs with
`environment: 'node'` and no jsdom, so `create-intake-form.tsx` cannot be
rendered in a test at all. The repo already answers this with
`lib/signer-view.ts`, which holds the signer page's decisions as plain
functions for the same reason. Without the extraction this change ships
untested.

It cannot live in `lib/intake-uploads.ts`, which is `'use server'`:
every export there is a public endpoint, so a sync helper either fails
the directive or becomes a needlessly reachable one.

Rules:

| filesAttached | reviewRequired | scorecard | blocked | reason | attachReview |
| --- | --- | --- | --- | --- | --- |
| false | either | any | false | null | false |
| true | true | none | true | not-run | false |
| true | true | failing | true | failing-grade | false |
| true | true | passing | false | null | true |
| true | false | none | false | null | false |
| true | false | failing | false | null | true |
| true | false | passing | false | null | true |

The row that carries the change is "not required, failing grade":
submission proceeds AND the scorecard is still attached. A poor grade is
information legal wants, not a reason to withhold the ticket.

### 2. `create-intake-form.tsx`

The submit handler calls `resolveIntakeReviewGate` with
`reviewRequired: !employeeMode`, sets the existing error state from
`reason` when blocked, and writes `intakeAnswers.review` when
`attachReview`. The two error strings keep their current wording for the
legal-team path.

### 3. Copy

The sentence shown under an attachment currently reads: "Attached
contracts must pass Advottic Review (grade C or higher) before this can
be submitted." That is false for an employee once this ships, so it gets
an employee variant describing the review as available rather than
required, and saying legal sees the result if they run it. Calm in tone,
no em dashes, wrapped in `<T>` like its neighbours. The legal-team
wording is untouched.

### 4. Stale comments

`lib/intake-uploads.ts` says at lines 106 to 107 that "The employee
intake form calls this before submit and gates the form on the resulting
grade (C or higher passes)", and at line 120 that a passing grade is
needed "before a request with an attachment can be filed". Both describe
the employee path specifically and both become wrong. They are corrected
in place.

## Testing

`tests/intake-review-gate.test.ts` covers every row of the table above,
with the "not required, failing grade" row asserting both that
submission is unblocked and that the scorecard still attaches.

Each guard then gets a mutation: `reviewRequired` forced to a constant,
each blocking branch removed, `attachReview` hardcoded. A guard whose
removal leaves the suite green is not covered, and gets a test or gets
deleted.

## Deliberately not doing

Server-side enforcement. The gate is client-side only today: nothing in
`createMatterIntakeAction` or `uploadIntakeFilesAction` rejects a
submission that lacks a passing scorecard, so the current requirement is
already bypassable by a crafted request. That is a real pre-existing
gap, but adding enforcement in the change that loosens the rule would
work against the request. Recorded here, not fixed.
