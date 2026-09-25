# Demo captures

The marketing site shows no pictures of the product. The answer chosen in
`docs/superpowers/specs/2026-09-24-marketing-screen-grabs-design.md` is
generated captures of the real signed-in app, taken against a local database
seeded from nothing.

This document is what that demo contains, how the stack is started, how it is
seeded, and the one rule the whole thing hangs on.

## The rule: captures never point at production

The production database holds privileged client matters. A screenshot tool
pointed at it, even signed in as a demo account, is a data-loss incident
waiting for a bad filter.

The control is structural and sits in `scripts/demo/seed-demo.mjs`. The first
statement of `seedDemo` reads the target's hostname and throws unless it is
`localhost` or `127.0.0.1`. It is a precondition, not a warning: it refuses
before a client is constructed and before a write is attempted.
`scripts/demo/seed-demo.test.mjs` proves it, and deleting the check turns that
test red.

Nothing in this path links to a hosted project. `supabase/config.toml` is a
local stack only; `supabase link` is not part of a capture run.

## What the demo contains

Two accounts, both invented, defined as data in `DEMO_MATTERS`.

**The person.** `demo.person@advottic.test` holds *Ramirez v. Oakline
Rentals*, a small-claims security-deposit matter with the claimant's posture
and a hearing on April 18. Exhibits A to D are `Signed lease agreement.pdf`
(Jan 3, 2024), `Move-out photos (kitchen).jpg` (Mar 30, 2025), `Text: "deposit
next week".png` (Apr 6, 2025) and `Itemized deduction letter.pdf` (Apr 9,
2025).

**The firm.** `demo.counsel@advottic.test` holds *Northwind Materials v.
departed engineer*, the commercial trade-secret matter the enterprise page
names, under request number REQ-0000412.

Both sets of strings are copied verbatim from the pages that show the same
matter, `app/page.tsx` and `app/enterprise/page.tsx`, so the sheet drawn on the
page and the screenshot printed beneath it cannot drift apart. The tests in
`scripts/demo/seed-demo.test.mjs` read those pages with comments stripped and
fail on any near-miss, including a changed date or a re-capitalised title.

## Starting the stack

```
supabase start          # API on 54321, database on 54322, Studio on 54323
node --test scripts/demo/seed-demo.test.mjs
node scripts/demo/seed-demo.mjs   # once the schema question below is settled
supabase stop
```

`supabase/config.toml` disables analytics and keeps mail inside Inbucket, so a
capture run cannot send a message.

## Which schema the stack applies, and why seeding is blocked

The stack applies `supabase/migrations/*.sql`, in filename order, followed by
`supabase/seed.sql`. That is the only schema input the CLI has:
`[db.migrations]` and `[db.seed]` in `supabase/config.toml`, with
`schema_paths` left empty. `supabase/schema.sql` is **not** applied by any
command. The repository already says so: its header reads "Paste this into the
Supabase SQL Editor", and `SETUP.md` describes it as a manual step.

Neither source can build this database, and they do not disagree so much as
fall short together:

- All 33 files in `supabase/migrations` fail against an empty database. They
  are incremental `ALTER`s; the earliest one alters
  `public.firm_matter_intakes`, a table no file creates. Applying all 33 in
  order leaves **0 tables**.
- `supabase/schema.sql` applies cleanly on a Supabase-shaped database and
  creates **7 tables**: `ai_reviews`, `case_collaborators`, `cases`,
  `close_surveys`, `exhibits`, `profiles`, `subscriptions`.
- The app reads or writes **100** distinct tables in `public`. **46** of them
  are created by no file anywhere under `supabase/`, including `firm_cases`,
  where the firm's matter would live.

This is a known, documented gap rather than a new discovery.
`supabase/fixes/2026-07-03-firm-core-rls-snapshot.sql` states that the
firm-core tables "live only in the Supabase dashboard, never in source" and
asks for a follow-up adding their `CREATE TABLE` DDL; that follow-up has not
landed. `docs/compliance/COMPLIANCE_READINESS.md` records the same drift as a
change-management gap.

So the person's case is reachable from committed sources and the firm's matter
is not. Until the missing DDL is in the repository, a capture run cannot build
the database it is supposed to photograph, and `seedDemo` throws rather than
pretending otherwise.

## Settling it

One of these has to happen before the captures can run:

1. Dump the live `public` schema into `supabase/migrations` as a single
   baseline migration, so the stack builds from nothing. This also closes the
   compliance gap and makes the schema-drift fingerprint meaningful.
2. Or accept the design's stated fallback, a separate Supabase project holding
   only invented data, and point the capture run at it. The local-only refusal
   in `seedDemo` would then need a deliberate, reviewed widening; it should
   not be loosened quietly.

Option 1 is the one the design assumes.
