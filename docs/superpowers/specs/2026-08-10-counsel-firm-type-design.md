# Firm type shapes the Counsel workspace

The `firms.firm_type` column has existed since
`supabase/fixes/2026-07-04-token-economy-schema.sql:45`, is CHECK-constrained
over six values, and is indexed. It is written at onboarding and at the public
request form, shown once in HQ lists, and then never consulted again. An
in-house legal team therefore sees Time, Billing, Trust, Leads and Referrals in
its rail, and is told the people it advises are "clients".

This closes that. No migration: the column exists, and the new per-firm override
lives in `firms.metadata`, which is jsonb and already carries `menuConfig`.

## 1. What each type defaults to, and why

| Type | Time / Billing / Trust | Leads / Referrals | Vocabulary |
|---|---|---|---|
| `individual` | shown | shown | base |
| `firm` | shown | shown | base |
| `legal_aid` | shown | shown | base |
| `other` | shown | shown | base |
| `corporate` | **hidden** | **hidden** | in-house |
| `government` | **hidden** | **hidden** | base |

`corporate` and `government` are the two types that do not bill an external
client, hold client funds in trust, or buy inbound work. Everything else keeps
today's behaviour, so no existing firm's workspace changes shape unless its
owner changes its type.

`legal_aid` deliberately defaults to shown. A legal-aid clinic bills some
matters under fee-shifting statutes, holds IOLTA, and receives referrals from
other organizations. Guessing otherwise would take a working surface away from
an organization that needs it.

Defaults are defaults. Every one is overridable, and the override wins.

## 2. The override model

`firms.metadata.surfaceOverrides`, a jsonb object:

```json
{ "timeBilling": "show" | "hide", "growth": "show" | "hide" }
```

Resolution, per surface, in `lib/firm-workspace.ts`:

1. An explicit `"show"` or `"hide"` override wins.
2. Otherwise, for `timeBilling` only, the legacy `firm_settings.hide_time_billing`
   boolean still forces hidden. A firm that hid Time and Billing before this
   change keeps it hidden whatever its type says.
3. Otherwise, the type default from the table above.

Step 2 exists because the legacy column is `not null default false`, so a stored
`false` cannot be told apart from never-touched. Treating it as a hide-only
latch is the only reading that preserves every existing choice.

## 3. The vocabulary layer

One map, `lib/firm-vocabulary.ts`, concept to noun. Only `corporate` overrides
the base, because in-house is the only type whose vocabulary the owner named.
Adding a column later is a table edit, not a code change.

| Concept | Base | `corporate` |
|---|---|---|
| `client` | Client | Employee |
| `clients` | Clients | Employees |
| `intake` | New intake | New request |
| `practiceAreas` | Practice areas | Business areas |
| `directory` | Employees | Directory |
| `caseload` | Cases | Matters |

The nav consumes this through `menuLabelsForType`, which produces the same
`href -> label` shape `lib/menu-config.ts` already supports at
`applyMenuConfig`'s `config.labels[i.href] ?? i.label`. No ternaries are added
to any page. A firm's own explicit label always beats the type-derived one.

`/counsel/clients` becomes "Employees" and `/counsel/employees` becomes
"Directory" for a corporate firm, which is the only pair where the base and the
in-house vocabulary collide.

## 4. Wiring: four seams, not seventy-four pages

1. `getFirmSurfaceSettings` in `lib/firm-settings.ts` becomes the resolver. It
   returns EFFECTIVE values. Its eleven existing call sites (three route guards,
   the dashboard, Reports, My work, the matter page, the header, the sidebar,
   the settings page) inherit type-awareness with no edit.
2. `app/counsel/layout.tsx` resolves the firm's menu config once and hands the
   resolved firm to the header and the sidebar, which both already read
   `readMenuConfig(firm.metadata)`. The settings page's menu editor reads the
   firm's own unresolved metadata, so the editor still shows what the firm set.
3. Route guards on the five Growth pages, matching the three that already exist
   on Time, Billing and Trust.
4. `lib/firm-surface-guard.ts` refuses the mutating server actions behind both
   surfaces. A hidden link is not a gate: every `'use server'` export is a public
   HTTP endpoint.

## 5. Where the type is changed

`/counsel/settings`, owner and admin only, in the same card as the surface
toggles. That is where every other decision about the shape of the workspace
already lives (the menu customizer, the surface toggles, the reference
prefixes), it is already role-gated in the page and re-checked in the action,
and it is the page an owner reaches when the workspace is wrong.

Changing the type destroys nothing. It changes which defaults apply. Invoices,
time entries, trust ledgers, leads and referrals stay in the database exactly as
they were; the surface is hidden, not purged. An owner who switches to in-house
and still needs last quarter's invoices sets the override to "Always show" and
the surface comes back with every row in it.

## 6. What is NOT type-dependent

- The `FirmType` enum. Six values are in production with real rows and they
  already cover what was asked.
- `government` vocabulary. Whether a state AG office calls the agency it advises
  a "client" or something else is a guess, and a wrong noun is worse than the
  ordinary one.
- `/counsel/billing/tokens`. That is Advottic's own subscription and token
  top-up, not client billing. An in-house team still pays for the product.
- Case, document, signing, timeline, evidence and approval surfaces. The work
  product of an in-house team and a law firm is the same work product.
- The consumer marketplace intake (`submitFirmLeadAction`). That is a member of
  the public submitting a request; a firm's own display choice must not break it.
- Roles, permissions, RLS. Type shapes the workspace, never who may reach what.
