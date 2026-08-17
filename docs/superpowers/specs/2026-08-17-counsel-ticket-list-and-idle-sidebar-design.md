# Counsel request list, and a rail that hides itself

Two changes to the counsel surfaces, from the owner, who runs the reference
product himself.

Reference confirmed by looking at it: `techottic.com/tickets`, signed in.
Saved-view tabs across the top, a dense sortable and filterable table,
per-column filter affordances, per-row checkboxes for bulk actions, a row
count beside the toolbar, one primary button. That is a service desk, so the
structure is taken and none of the vocabulary is.

---

## 1. The request list

### Where it lives

`/counsel/inbox` is the counsel-side queue for everything landing on the legal
team, and it is the list this is about. `/portal/requests` (an employee's own
requests) and `/admin/counsel-requests` (HQ) are different readers and are out
of scope.

What is there today is a stack of four lane groups of cards. What replaces it
is the list pattern this repo already ships at `/counsel/cases`: a view strip,
a toolbar, a dense table with a per-column filter row, and a pager.

### Reuse, not a parallel build

The status vocabulary is not touched and not widened. The nine states in
`firm_matter_intakes.workflow_state` (`lib/intake-workflow.ts`) are what this
screen sorts, filters and paints by, and every label, tone and lane claim comes
from that module. Widening `status`'s seven-value CHECK instead would have
parked every `awaiting_*` request in "Needs attention" forever, which is why
the column exists.

Shared already and reused as-is: `ViewStrip`, `Toolbar`, `MonoRef`, `Chip`,
`relativeTime` (`components/counsel/patterns.tsx`), `StatusPill`, `PageHeader`,
`EmptyState`. `paginateMatters` is generalised into `lib/list-paging.ts` and
`lib/matter-list.ts` delegates to it, so there is one pager arithmetic and not
two.

New: `lib/intake-list.ts`, the pure query-state module (what a URL means and
what it selects), shaped exactly like `lib/matter-list.ts`, and
`app/counsel/inbox/requests-table.tsx`, the client table.

Deleted: `components/counsel/IntakeInbox.tsx`, whose job this takes over. Three
existing guards name that path and are repointed at the file that now holds the
behaviour they check, without loosening what they assert.

### The tabs

Seven, the same shape as the reference's seven, each built from a set a request
can actually be in.

| Tab | What it selects | Where the words come from |
|---|---|---|
| All open | workflow state not in `DECIDED_WORKFLOW_STATES` | `lib/intake-workflow.ts` |
| New | state is `new` | one of the nine |
| Mine | `assigned_to` is the signed-in member | the column |
| Unassigned | `assigned_to` is null | the column |
| Awaiting others | state is one of the three `awaiting_*` | three of the nine |
| Urgent | priority is `Urgent` | `INTAKE_PRIORITIES` |
| Everything | every request, decided included | - |

What the reference has and this does not, because the product has no such
fact: **VIP** (no client tier exists), **SLA at risk** and **Escalations** (no
due date, no escalation state, and inventing a red "Breached" the data cannot
support would be the screen lying). "Awaiting others" is the honest analogue of
blocked work: somebody outside this team owes us something. "Urgent" is the
product's own priority field at its own top value, so the tab means exactly one
value of one field and cannot drift.

"Mine" is dropped from the strip when the session has no user id, as the matter
list already does, because a "Mine" showing the whole firm's queue is a lie.

`All open` is defined by the nine and not by `isIntakeOpen` (the seven-value
lane test) on purpose. The two disagree in one case, deliberately: a
`converted` request whose workflow state is `awaiting_signatures` is live work
to the legal team and sits in the `accepted` lane for the employee. A work
queue must not hide live work, so this screen reads the vocabulary built for
its own question. The Impact KPI keeps `isIntakeOpen`, and a new behavioural
test pins the invariant that stops the two contradicting each other: every
state that means the firm is finished writes a legacy status the employee also
reads as finished.

### The columns

Checkbox, Priority, Reference, Subject, Requester, Status, Owner, Age,
Updated. Sortable: priority, subject, status, requester, owner, age, updated.
Filterable in the row under the header: reference, subject, requester, status,
owner, source, priority.

Translated from the reference rather than copied:

- **Priority** is `Low / Normal / High / Urgent`, the product's four words, not
  P1/P2.
- **Reference** is `REQ-XXXXXXX` or the partner's own external id, from
  `refFor`, resolved on the server because that helper is `server-only`. It is
  set in `text-muted`, not in the accent: the reference site paints it orange
  and this may not, because the accent is spent once and it is spent on the
  primary button.
- **Requester** is an initials avatar plus the name, plus an `In-house` chip
  where the reference puts a VIP star. There is no VIP.
- **Status** is the workflow pill over the nine states, replacing the row's old
  seven-value label map.
- **Age** is how long the request has been open, quiet and `tabular-nums`. This
  is where the reference puts SLA. It carries no red, because nothing in this
  product records what a request was promised by.
- The Advottic Review grade badge is **not** on the row. Priority, requester
  and status are already three coloured marks and a fourth across twenty-five
  rows is the siren `docs/DESIGN.md` warns about. The grade stays on the record
  and in the scorecard.

### Counts

A count over a capped read has shipped here four times. The reads are:

1. one bounded read of the rows the table draws, `INTAKE_LIST_READ_LIMIT`, the
   only `.limit()` on the page, and
2. one separate uncapped `count: 'exact', head: true` for how many requests the
   firm has.

The toolbar states `Showing N-M of T` for the set the current view and filters
select. Each tab's count is the length of the list that tab would render,
computed by `intakeViewCounts` from `filterIntakes` itself, so a tab can never
claim twelve over an empty table. When the bounded read did not reach the
firm's whole history the page says so in a sentence rather than presenting a
floor as a total.

No `Columns` picker and no `Filters` popover. The per-column filter row is
always visible, which is denser than a popover and is what this repo already
ships; a column-visibility picker has nowhere to persist a per-user choice and
is not being invented for the look of it.

### Bulk action

The checkbox column exists because there is one real thing to do with a
selection: give the requests an owner, one `assignIntakeAction` call per row.
That action re-resolves access and refuses anyone who is not on the legal team,
so a call from a row is gated exactly as a call from the record is and nothing
new is exposed. If that ever goes, the checkboxes go with it.

---

## 2. The rail hides itself when left alone

The panel hides after five seconds with no click, no hover and no focus, slides
left, and comes back when the cursor reaches the screen edge. The edge reveal
already exists as a pure decision in `lib/sidebar-edge-reveal.ts` because
`document` fires `pointerleave` continuously at clientX 5 and a naive cancel
killed every dwell. The idle rule joins it there rather than becoming a second
timer in an effect.

### The decision

`idleHideBlocker(sample)` returns why the panel must not hide right now, or
null. In order: focus inside, pointer over it, a held button, an open menu or
popover inside it, a live text selection. The component keeps only what needs a
browser: the media query, the listeners, the timer, and the flags it carries.

Non-negotiables and how each is met:

- **Never while focus is inside.** `focusWithin` is the first blocker. A
  keyboard user tabbing the nav would otherwise lose it mid-navigation, and
  because the panel unmounts its children when collapsed, focus would land on
  `<body>`.
- **Never mid-interaction.** A held button is a drag, an open menu is a
  decision in progress, and a live selection is a sweep. Each blocks.
- **A blocked deadline re-arms, it does not cancel.** Otherwise letting go of a
  drag over the rail would disable the behaviour until the next interaction,
  which is the same trap the edge zone's "neither refusal disarms" rule exists
  for.
- **`prefers-reduced-motion` removes the animation, not the behaviour.** The
  panel already carries `motion-reduce:transition-none` on the width
  transition, so it arrives instantly. Verified on the rendered page, not
  assumed from the class.
- **The explicit control stays.** The collapse button when open and the
  page-keeper tab when collapsed are real buttons, Tab-reachable and
  Enter-activated. Nothing is taken away.
- **Five seconds is `IDLE_HIDE_MS`**, a named constant with the reasoning
  beside it, because somebody will want to tune it.

### Touch

The rail is `hidden md:block`, so below 768px it does not exist and a
completely separate mobile nav is in play. Above 768px a device can still be
touch-only, and there the auto-hide is refused: it gates on the same
`(hover: hover) and (pointer: fine)` query the edge reveal gates on. The reason
is that the two are one feature. The fast way back is the screen edge, an edge
gesture is unaimable without a pointer and competes with the browser's own
back-swipe, so a touch user would get a panel that hides itself and only a tab
to get it back. Auto-hiding is a mouse convenience and it is offered only where
the mouse is.

---

## How this is verified

Baseline on `origin/main` measured first: 258 files, 4321 passed, 1 skipped.
Then `npx tsc --noEmit`, `npm run build`, `npx vitest run`,
`npm run test:audit-guards`.

Then the page is rendered and looked at, in both themes, at 375px and 1280px,
checking that nothing but the page scrolls sideways and that the accent is
claimed once.

Then the idle-hide and the edge reveal are driven with real trusted input
through puppeteer-core against system Chrome, asserting `e.isTrusted`, with a
positive control that proves the harness can fail. The browser MCP tools are
not used for this: they move the page programmatically and would report a pass
that never happened. The theme is set through
`localStorage['advottic-theme']`, because that is where it comes from and
`emulateMediaFeatures` does nothing here.

Every source-reading guard strips comments before matching, and every one is
mutated to confirm it goes red.
