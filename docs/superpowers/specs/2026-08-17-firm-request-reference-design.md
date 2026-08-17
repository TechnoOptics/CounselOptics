# A firm-scoped reference on every legal request

Date: 2026-08-17
Branch: `feat/firm-ticket-reference`, cut from remote `main` at `f2fa1f48`.

## The ask

A legal request should carry a unique, human-readable, firm-scoped reference.
The owner's example, for Zinpro, is `ZT0001000`.

## What already exists, and what is actually missing

Most of this is built. `lib/ticket-numbers.ts` holds the arithmetic and
`lib/ticket-allocator.ts` holds the atomic write, and between them they already
run two per-firm series:

| series | table | column | prefix column | default |
|---|---|---|---|---|
| employee submissions | `firm_template_submissions` | `ticket_number` | `firm_settings.ticket_prefix` | `REQ` |
| firm matters | `cases` | `matter_number` | `firm_settings.matter_prefix` | `MAT` |

What has no number is the **legal request itself**: a `firm_matter_intakes`
row, the thing the portal and the counsel inbox both call a request. Its
reference comes from `refFor` in `lib/intake-notify.ts:166`, which prefers a
partner's `externalId` and otherwise derives `REQ-4F2A9C` from the uuid.

So this is a third series on an existing engine, not a new mechanism.

## Decisions

### D1. Existing references are never renumbered

**New requests get a number. Existing requests keep the reference they have.**

`refFor`'s output has already gone out: in notification email subject lines and
bodies (`lib/intake-notify.ts:341`), in partner API payloads
(`lib/partner-tickets.ts`), and on the portal request page
(`app/portal/[id]/page.tsx:378`, which literally tells the reader to quote it).

Backfilling would give one request two references and make yesterday's email
cite something that no longer matches the record. For a legal record that is
worse than an ugly reference.

This is also the codebase's own precedent, and the precedent cuts both ways
deliberately. `firm_template_submissions.ticket_number` is never backfilled,
because a submission had already been emailed under a derived reference.
`cases.matter_number` **was** backfilled (`20260813_matter_number.sql:63`),
but only because a matter had never had a reference of its own to contradict.
An intake has. So intakes follow the submission rule, not the matter rule.

**Consequence, stated plainly:** for a while a firm's queue shows two shapes of
reference side by side, `REQ-4F2A9C` on older requests and `ZT0001000` on newer
ones. That is the price of never invalidating a reference already sent to a
person, and it is the right price.

### D2. Old references keep resolving

Something does resolve a reference back to a request:
`lib/intake-list.ts:365` and `:377` filter and search the counsel inbox on
`IntakeListRow.reference` by substring.

Because D1 leaves old rows unnumbered, `displayRequest` returns their original
derived reference, and that search keeps working unchanged for every reference
already sent. Had we backfilled, every previously-sent reference would have
stopped matching in the one place the product looks references up.

### D3. Uniqueness is the database's job, not the code's

Allocation reuses `allocateSeries` in `lib/ticket-allocator.ts`: read the
firm's highest number, add one, write it conditional on the column still being
null, and on a `23505` unique violation bump and retry.

That loop is an allocator only because of the index underneath it. This
migration therefore creates:

```sql
create unique index if not exists firm_matter_intakes_request_number_idx
  on public.firm_matter_intakes (firm_id, request_number)
  where request_number is not null;
```

A `select max(n) + 1` without that index races. Two employees filing at once is
an ordinary Monday. The index is what makes a duplicate impossible rather than
unlikely; the retry only decides who politely takes the next one.

### D4. A number is immutable once assigned

The write is `.is(column, null)`, so a row that already has a number cannot be
renumbered by a retry, a second tab, or a late caller. Allocation happens once,
at creation. Nothing derives a number from a row's position in a list, so a
deletion renumbers nothing.

The series is therefore gappy on purpose: a deleted request retires its number
permanently. That is the existing, documented choice for both sibling series.

### D5. Shape

`prefix + 7 zero-padded digits`, e.g. `ZT0001000`.

The seven-digit pad is load-bearing and inherited: the allocator reads the
highest number back with an `ORDER BY` on a TEXT column, and a text sort agrees
with a numeric one only while every number is the same width. The series
refuses at 9999999 rather than growing an eighth digit.

**No separator**, matching the owner's example exactly. The two existing series
keep their hyphen; changing them would mix widths inside a live series and
break that same text sort.

### D6. The prefix is stored per firm and editable, not derived

`firm_settings.request_prefix`, normalized by the existing `normalizePrefix` to
2-8 characters of `A-Z0-9`.

Derived-from-firm-name was rejected: a firm renames itself, and a derived
prefix would silently change the shape of future references while old ones keep
the old letters, which is D1's problem reintroduced by the back door. It also
gives two similarly-named firms the same letters with no way to override.

**Default `TKT`** for a firm that sets none. Deliberately not `REQ`: that is the
submissions default, and `20260813_matter_number.sql:52` already spells out why
two counters must not share a prefix, since one shared prefix eventually issues
the same reference for two different kinds of record.

### D7. Cross-firm collision is expected and correct

Numbers are scoped per firm: the read is `.eq('firm_id', firmId)` and the index
is `(firm_id, request_number)`. Two firms both on the default `TKT` will both
hold `TKT0001000`, exactly as two firms both hold `MAT-0000001` today.

Nothing resolves a request by reference alone. Every route, link and lookup
keys on the intake uuid, and the one place the reference is used to select (the
inbox filter, D2) already runs inside a single firm's rows. A firm that wants a
globally distinctive reference sets its own prefix, which is what Zinpro's `ZT`
is.

### D8. Partner `externalId` precedence is unchanged

Display order stays `externalId` → allocated number → derived uuid reference.
A partner-supplied id is that partner's own record key; their system quotes it
and expects it back, so it must keep winning.

### D9. Security

No new table, so no new RLS surface. Two columns are added to existing tables
that already carry exactly this firm data, and the existing row policies govern
them unchanged. This deliberately avoids the `firm_policies` trap of a new
table with RLS enabled and zero policies.

The allocator is `server-only`, not `'use server'`, so it is not itself an HTTP
endpoint. No caller can choose its own reference: the number is derived from the
firm's series and nothing accepts a caller-supplied value. No caller can
allocate against another firm: the write is scoped `.eq('firm_id', firmId)` with
`firmId` taken from the authenticated session or the verified partner token,
never from request input.

## Open questions the owner must settle

Both are single named constants, changeable in one line.

1. **The starting number.** The example starts at 1000, so `FIRST_REQUEST_SEQ`
   is 1000 and a firm's first request is `ZT0001000`. Whether every firm starts
   at 1000 or only Zinpro was not confirmed.
2. **The separator.** The example has none, so this series has none, unlike
   `REQ-0000412`. Whether the owner wrote that deliberately was not confirmed.

## Verification

- Concurrency proven by racing many allocations in parallel against a fake that
  enforces the unique constraint, asserting zero duplicates, and by deleting the
  concurrency control to confirm the test goes red.
- Source-reading guards mutated to confirm red.
- The counsel queue, the request page and the portal rendered and read.
