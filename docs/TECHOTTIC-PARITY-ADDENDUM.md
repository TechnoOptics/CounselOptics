# Techottic parity, addendum: the screens the first spec never saw

`docs/TECHOTTIC-PARITY-SPEC.md` was written from four screens: dashboard, ticket
queue, request forms, ticket detail. **Reports and My KPIs were never captured**,
and section 7 of that file records the gap honestly rather than guessing at them.

This addendum closes it. Captured 2026-08-10 from a signed-in Techottic session
at `techottic.com`, on `/tickets`, `/tickets/{id}`, `/reports` and `/my`.

**No customer data appears in this file.** The captures contained real names,
email addresses and phone numbers. Nothing personal is reproduced here; every
example below is either structural or invented. Do not copy identifying values
out of a screenshot into code, a fixture, a test or a commit message.

---

## 1. The left rail

Reading down: brand mark with an environment chip beside it; a scoping panel; a
group of overview links; a group of section links; a user footer pinned to the
bottom.

**Group labels** are their own line, uppercase, letter-spaced, small, muted, and
carry no icon: `OVERVIEW`, `SERVICE DESK`. They are labels, not links.

**Links** are icon plus label, the icon on the left at a fixed gutter so every
label starts on the same x. The active item gets a tinted pill spanning the full
rail width, a coloured label, and a coloured icon. Inactive items are a muted
icon with a foreground label.

**The scoping panel is a control, not a readout.** It lists the departments the
reader may switch between, each row carrying a right-aligned mono prefix code
(`FIN-`, `FLT-`, `HMR-`) which is the same prefix that appears on that
department's ticket references. The current scope carries a check. Below the
list, a short explanatory paragraph in the accent colour states what the current
scope hides.

> **Advottic does not copy this panel.** The counsel rail's equivalent was a
> passive readout and was removed on the owner's instruction. What Advottic
> should take is the SHAPE of the group label, the link, and the user footer,
> not a scope switcher counsel has no use for.

**The user footer** is avatar, then name over role in two lines, then a power
icon at the right edge.

## 2. Symbols

Outline stroke icons throughout, single weight, no fills, no emoji, roughly the
cap height of the label beside them. Every navigation item has one; group labels
never do. Buttons carry an icon only when it names the action (a printer for
Print, a download tray for Export, an arrow for Escalate).

Directional affordances are a plain arrow appended to a text link: `Full profile
→`, `Open asset →`, right-aligned in a card header.

## 3. Stat tiles

Used identically on Reports and My KPIs: **a row of six**, equal width, each a
bordered card containing

1. an uppercase, letter-spaced, muted label,
2. a large value,
3. an optional small muted caption.

**Value colour is semantic and it is the only colour decision on the tile:**

| Meaning | Colour |
|---|---|
| Needs attention now | red |
| A rate, a share, or a brand-positive figure | accent |
| A plain count with no judgement attached | near-black foreground |

A metric with no data yet shows a dash in place of the number, in that metric's
own colour, with the caption still present (`0 responses`, `0 ratings`). It does
not hide the tile and does not print a zero it cannot justify.

## 4. Cards

White, rounded, hairline border, generous internal padding.

**Card titles are uppercase, letter-spaced, and carry their qualifier inline
after a middle dot**: `CSAT TREND · 8 WEEKS`, `TICKET VOLUME BY CATEGORY · 30
DAYS`, `MY OPEN QUEUE · HEAVIEST FIRST`. The qualifier states the period or the
sort, so the number can never be read over the wrong window. Copy this: it is
the single most transferable habit on these screens.

**Empty states are one plain sentence inside the card** (`No survey responses
yet.`). No illustration, no call to action, no apology.

**A row inside a card** reads: priority pill, mono reference, subject, then
right-aligned status. The reference is mono and tinted; the subject carries the
weight.

## 5. Reports and My KPIs

Both open with a page title and a one-line subtitle. Reports subtitles the
AUDIENCE and content (`Leadership view - service levels, satisfaction, demand
patterns and team output.`); My KPIs subtitles the reader's own IDENTITY
(`<org> · <role>`).

Reports carries two header actions: a secondary Print and a primary Export.
My KPIs carries none, because there is nothing on it to export that Reports
does not already give you.

Below the stat row: a two-column band of charts, then a three-column band of
smaller panels. Charts are flat, no gridline chrome beyond a faint horizontal
rule, one accent hue with tints for ranking, category labels right-aligned
against the bars.

## 6. Ticket detail, re-observed

Breadcrumb `Section / REFERENCE`, then the subject as the page title, then a
meta row of pills: status, priority, a weight, an escalation flag, and a plain
sentence stating age and channel (`opened 23h ago via portal`).

**Then a full-width action bar in its own bordered card**, holding every field
that changes the record as inline selects (Status, Priority, Assignee, Group),
then the SLA statement in red when breached, then a secondary and a primary
action. **The record's controls are gathered in one strip rather than scattered
down the page**, which is the structural point worth copying.

Body is two columns: the narrative and its attachments on the left, the people
and the equipment on the right. Sidebar cards lead with an uppercase label and a
right-aligned `→` link to the full record.

## 7. What this means for Advottic

The mapping in section 4 of the main spec still holds. Two additions:

- **Reports and My KPIs have no Advottic counterpart yet.** `/counsel/analytics`
  (Impact) is the nearest, and it is a different thing: firm-wide outcomes rather
  than service levels. A counsel Reports screen and a per-person KPI screen are
  new work, not a restyle.
- **A ticket maps to a firm intake request**, not to a matter. The action bar,
  the meta pill row and the two-column body all transfer. The device sidebar does
  not: counsel's equivalent right column is the client and the matter.
