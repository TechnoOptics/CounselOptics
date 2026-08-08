# Advottic counsel, rebuilt to Techottic's shell and patterns

Written 2026-08-07 from the LIVE techottic.com app, signed in, both themes,
four screens captured: dashboard, ticket queue, request forms, ticket detail.
Not from docs/DESIGN-LAYOUT.md, which only describes tokens and says nothing
about layout.

**The decision this implements.** "Keep gold, match everything else."

Advottic's gold accent stays, and the per-firm accent derivation stays with it.
Everything else matches Techottic: the neutral ramp, the surface scale, the
typography, the shell, the density, and the list, form and detail patterns.

**Two corrections to what I first assumed, both found by looking at the live
signed-in app rather than at the marketing site.**

1. **Counsel is already dark.** It is not cream. The near-black ground, the
   grouped nav with tiny uppercase section labels, and the tinted rounded-rect
   active state already exist and already resemble Techottic.
2. **The gap is five things, not a rebuild.** Serif headings, a sidebar that
   floats in a rounded panel instead of running flush, no scope switcher, no
   global search or theme toggle, and prose-led pages where Techottic has dense
   tables.

Anything in this document that reads as "replace Advottic's identity" is wrong
and superseded by this section.

---

## 1. Tokens, exact

Adopt Techottic's values verbatim. Advottic already has the `-text` family; it
gains the rest.

| Token | Dark | Light |
| --- | --- | --- |
| `--background` | `#0a0a0b` | `#f6f6f7` |
| `--surface` | `#101012` | `#ffffff` |
| `--surface-2` | `#17171a` | `#f0f0f2` |
| `--border` (Tailwind `edge`) | `#232327` | `#e2e2e6` |
| `--border-bright` (`edge-bright`) | `#33333a` | `#cfcfd6` |
| `--foreground` | `#f4f4f5` | `#17171b` |
| `--muted` | `#9c9ca6` | `#5d5d68` |
| `--accent` | **gold, unchanged** | **gold, unchanged** |
| `--accent-2` | **gold, one step** | **gold, one step** |
| `--accent-text` | **derived from the firm accent** | **derived from the firm accent** |
| `--warn-text` | `#fcd34d` | `#92400e` |
| `--danger-text` | `#f87171` | `#b91c1c` |
| `--info-text` | `#a5b4fc` | `#4338ca` |
| `--code-bg` | `rgba(0,0,0,0.32)` | `rgba(0,0,0,0.06)` |
| `--code-fg` | `#6ee7b7` | `#047857` |

`--accent` is identical in both themes. Only text variants move. Fills use
`--accent`; text uses `--accent-text`. Never both.

**Keep Advottic's per-firm derivation.** Advottic is multi-tenant and Techottic
is not, so `--accent-text` stays computed from `--firm-accent` in OKLCH with the
existing lightness floor. A firm that has set no accent falls back to `#059669`
rather than to gold. This is the one place Advottic must stay ahead of
Techottic, and `lib/accent-text.ts` already does it.

**Typography.** Geist replaces Fraunces and Inter on counsel and portal.
Monospace (`ui-monospace`) for every reference: matter numbers, ticket numbers,
slugs, SHA fragments. Advottic currently uses a serif display face; it goes on
these surfaces.

---

## 2. The shell, as observed

Fixed left sidebar, roughly 236px, on `--surface`, its own scroll, with a
1px right edge.

- **Top:** accent glyph + wordmark, then an environment badge (`PROD`) in a
  small uppercase mono chip.
- **A scope panel**, boxed and inset on `--surface-2`, headed `VIEWING AS` in
  tiny uppercase with an eye icon. Rows are scopes; the active one carries a
  check and an accent tint. Each row shows a right-aligned mono prefix.
  **Advottic mapping:** this is the firm's practice areas or matter groups, and
  each row's mono prefix is the firm's ticket prefix per
  `firm_settings.ticket_prefix`. `Everything` stays the default row.
- **Grouped nav** with tiny uppercase section labels. Active item: accent tint
  fill, accent text, rounded rect, and a 1px accent ring.
- **User card pinned to the bottom:** avatar, name, role beneath, and a power
  icon that signs out.

Top bar, spanning the content column only, not the sidebar:

- A **full-width contextual banner ABOVE everything**, amber, for a live
  condition. Advottic mapping: a matter under a deadline inside 48 hours, or a
  submission waiting on approval past its SLA.
- A wide search input, roughly 310px, rounded, with a `⌘K` chip inside it.
- Right: theme toggle (sun in dark, moon in light), and a bell with a count
  badge.

---

## 3. Page patterns

### List page (maps to counsel Matters, Documents, Signing, Forms)

1. Title, ~28px, weight 700, tight tracking.
2. Subtitle in `--muted` that states the count and what the page can do:
   "47 tickets · page 1 of 1. Sort any column, filter any column, select rows
   for bulk actions." Advottic must say the equivalent truthfully, not
   aspirationally.
3. Actions top-right: a secondary outline button, then a primary accent-filled
   button with a leading icon.
4. **Segmented view strip** in a bordered container. Active segment is an
   accent-tinted pill. Observed on tickets: All open, Mine, Unassigned, VIP,
   SLA at risk, Escalations, Everything.
5. **Toolbar row:** search input left; `Filters` and `Columns` buttons right;
   row count as plain muted text.
6. **Table.** Checkbox column. Uppercase column headers with sort and filter
   affordances per column. Row anatomy observed: priority chip, mono reference,
   bold subject with an optional muted sub-line, requester as coloured avatar
   initials plus name, status pill with a leading dot, assignee (`Unassigned` in
   danger text), SLA state in bold danger text, relative time.

### Configuration list page (maps to counsel Forms and Templates)

Observed on `/forms`, and it is close to a one-for-one with Advottic's Forms:

- Title, then a genuinely explanatory two or three line subtitle.
- Secondary `Categories` button plus primary `+ New request type`.
- Segmented scope filter across departments.
- Cards, not table rows. Each card: bold name, a scope chip, an optional
  `DEFAULT` badge, a right-aligned mono slug, a description line, a metrics row
  (`7 questions · 5 required · 7 written onto the ticket · 1 conditional`), then
  a row of field-type chips (Short text, Long text, Single select, Date, File
  upload, Person picker).
- Advottic's counsel Forms page is currently a `divide-y` list of plain rows.
  It becomes this.

### Detail page (maps to counsel Matter and Document detail)

- Contextual banner when a condition applies, with an icon.
- Breadcrumb: `Tickets / TKT-1005`, the reference in mono.
- Title, then a meta chip row: status pill with dot, priority chip, a weight
  readout, a warning chip, then plain muted provenance text
  ("opened 11d ago via app · San Francisco HQ").
- **Action bar as its own bordered card:** inline labelled selects (Status,
  Priority, Assignee, Group), a right-aligned SLA state in danger text, then a
  destructive-outline button and a primary accent button, both with icons.
- **Two columns.** Main: cards with uppercase letterspaced headers
  (`REPORTED ISSUE`, `ATTACHMENTS · SCREENSHOTS, VIDEOS & DOCUMENTS` with a
  dashed drop zone, `LIVE SESSIONS`). Aside: a person card whose border turns
  amber for a VIP, with avatar, name, role, and contact rows each led by an
  icon; then a related-record card with a `Open asset →` link in its header and
  a version status line.

---

## 4. Domain mapping, Techottic to Advottic

| Techottic | Advottic counsel |
| --- | --- |
| Department scope, `VIEWING AS` | Practice area or matter group |
| Tickets, `Ticket Queue` | Matters |
| Request Forms | Forms and templates |
| Procedures | Playbooks and approaches |
| Knowledge Base | Guides |
| On-Call and Flow | Deadlines and reminders |
| Surveys | Client feedback |
| Techottic HQ | Advottic HQ, already exists |
| Requester, VIP | Client contact, key client |
| SLA breached | Deadline missed |
| P1 / P2 | Matter priority |

Do not carry over anything Advottic does not have. An empty Live Map or a
fabricated CSAT number is worse than an absent nav item.

---

## 5. Slices

1. **Tokens and Tailwind theme.** Full token set, both themes, per-firm accent
   derivation preserved, Geist wired. Retire the `.dark .text-forest-900`-style
   per-class overrides in `app/globals.css`, which currently reassign palette
   classes and are load-bearing.
2. **The shell.** Sidebar with scope panel and grouped nav, top bar with
   search, theme toggle and bell, bottom user card. Counsel first, then portal.
3. **List pattern.** Page header, segmented views, toolbar, table. Applied to
   Matters first.
4. **Configuration list pattern.** Applied to counsel Forms.
5. **Detail pattern.** Applied to the Matter page.
6. **Sweep.** The 103 counsel files still setting colour with literal palette
   classes move onto tokens. This is what makes slice 1's override removal safe.

---

## 6. Rules that bind every slice

- No em dashes anywhere, including comments and UI copy. No emoji.
- Never hardcode a text colour. Use the `-text` tokens. This is Techottic's own
  first rule and the reason its `-text` family exists.
- `--accent` and `--accent-2` are fills. Text uses `--accent-text`.
- Every claim in copy must be true of the code. A subtitle promising column
  filtering when nothing filters is the defect class this project has hit
  repeatedly.
- Contrast floors hold for any firm accent, not just the default, because the
  tokens are derived. `tests/accent-text.test.ts` already pins this; extend it
  rather than replacing it.
- `npx tsc --noEmit`, `npm run build`, `npx vitest run`, and
  `npm run test:counsel-i18n` at the same 11 pre-existing wraps, before each
  commit.

## 7. The verification gap that must close

Nobody has ever seen Advottic's counsel surface rendered. Every design change
so far was verified by tests and the compiler only, because those pages need a
signed-in firm admin. **This work cannot be considered done on test evidence.**
The owner has a logged-in Chrome; screenshots of counsel before and after each
slice are the acceptance evidence.

---

## 8. Production access, added 2026-08-07 after an incident

A subagent on slice 1 wrote and ran a script against the LIVE Supabase
database using the service-role key, querying `firm_members`, `firms` and
`profiles`, and printed real admin and owner email addresses and firm names
into its transcript. It was trying to find a firm admin so it could sign in and
screenshot a counsel page, which the brief had asked it to do. Nothing reached
a commit and the working tree was clean, but the read happened and it was never
authorized.

**The rule, for every agent on this project from now on:**

- Never read, write or query the production database to complete a UI task.
  Not to find an account, not to check a value, not to take a screenshot.
- Never write an ad hoc script that loads `.env.local` and talks to Supabase.
- If verifying a change requires a signed-in session, say so in the report and
  stop. A stated verification gap is worth more than an unauthorized read.
- Read-only production queries are for a task that explicitly names production
  as its subject, and only when the brief says so.

Whoever writes the next brief carries this forward. The failure was in the
briefing, not only in the agent: the brief demanded a signed-in screenshot and
did not say how far the agent was permitted to go to get one.
