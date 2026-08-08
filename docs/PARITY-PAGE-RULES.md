# Applying the patterns to every page

There are 74 page files under `app/counsel` and `app/portal`. The patterns they
should use are already built and shipped: `components/counsel/patterns.tsx`, and
the three page shapes in section 3 of `docs/TECHOTTIC-PARITY-SPEC.md`.

**So this is application, not invention.** Nobody should be designing a new
page shape. If a page seems to need one, that is a finding to report, not a
licence to draw something fresh.

## Classify every page as exactly one of four

**LIST** — anything that shows a set of records the user picks from.
Page header with a subtitle that states the count and what the page can do,
secondary plus primary action top right, segmented views with real counts, a
toolbar, then a table with sortable and filterable columns, mono references and
status pills. Matters (`cases`) is the built reference.

**CONFIG LIST** — anything that shows a set of things the firm has configured.
Cards rather than rows: name, a scope chip, an optional badge, a right-aligned
mono slug, a description, a metrics row, then type chips. Employee forms
(`forms`) is the built reference.

**DETAIL** — anything reached by clicking one record.
Breadcrumb with a mono reference, meta chip row, the action bar as its own
bordered card, then two columns: cards with uppercase letterspaced headers on
the left, a related-record aside on the right. The matter page is the built
reference.

**DASHBOARD** — a page that summarises rather than lists.
A strip of metric cards across the top, then a grid of cards. Each metric is a
tiny uppercase label, a large number, and a small sub-label, coloured
semantically. Nothing else on the page competes with the strip.

## The rule that overrides all four

**A page only gets a pattern element it has real data for.**

- No metric strip on a page with no metrics. An invented number is worse than a
  plain heading.
- No segmented views unless each view is a real subset with a real count.
- No filter control that filters nothing, no checkbox column without a bulk
  action, no badge without a state behind it.
- A subtitle describes what the page does, not what it might do one day.

This project has shipped a "Revoked" badge with no revoke action, an admin page
advertising a manual trigger that never existed, and a false "at least 2 admins
required" warning. Every one of those was a control drawn before the thing
behind it existed. Do not add to that list to make a page match a screenshot.

## What is NOT being copied

The reference product's device, asset, fleet, satisfaction-score and live-map
surfaces. The owner ruled them out explicitly: Advottic does not track what
device anyone is using, and a page of invented telemetry would be worse than no
page.

## Both themes

Light and dark are both live. Everything must work in both, and any NEW surface
must be registered with the per-surface contrast guard in
`tests/accent-text.test.ts` rather than routed around it. That guard exists
because a colour shipped wrong once and was caught only by measurement.

## Reporting

For every page touched, state the pattern chosen and one line of why. For every
pattern element deliberately left out, state what was missing behind it. That
list is the useful output of this work, more than the diff.
