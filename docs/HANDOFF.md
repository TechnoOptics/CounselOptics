# Handoff, 2026-08-17

`origin/main` is `43734a02`. Verify that before believing anything below:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --short main origin/main HEAD
```

That is not ceremony. See "The mistake that cost the most" at the end.

---

## Needs a decision, and nothing moves without it

**Apply the ticket workspace migration.** `supabase/migrations/20260816_intake_workflow_state.sql`
on branch `feat/ticket-workspace-ops` (worktree `/Users/technooptics/Advottic/wt-ticket-workspace`).
Written, NOT applied. Reads degrade safely; **writes to status, follow-up and
due date will error until it is applied**, and the CI fingerprint gate fails
while `supabase/schema-fingerprint.sha256` is stale. Migrations go before the
push in this project. Apply it, regenerate the fingerprint, then merge.

**The `staff` role and signed documents.** `firm_signing_requests_member_select`
admits any firm member with no role filter. `firm_documents_member_select`
excludes `staff`. So a panel built from signing requests alone discloses to a
receptionist exactly what `20260731_staff_role_read_scope.sql` was written to
prevent. Two independent agents read the asymmetry as an oversight rather than a
decision. It is a one line policy change on a production security boundary, so
it is the owner's.

**Two commits that email real people, still held.** `fa21d75` (deadline reminder
sweep) and `eaa4026d` (a daily sweep telling the two waiting parties). Both off
main. They send mail to actual users on a cron.

**Whether Advottic keeps uploaded source files.** `lib/firm-templates.ts:599`
extracts a file's text at upload and the file itself is never stored, so a
template is plain text and the original layout is gone before anything renders
it. That is the whole answer to "my document was in pages and had its own
formatting, why did that change". Restoring it needs a storage bucket, RLS, and
a retention entry in `docs/compliance/`, because these documents can carry PHI.
Not started deliberately: it changes what a template IS.

**Witness or second signer.** Two questions gate the design. Does a witness sign
in the SAME session, or by their own emailed link? Is the extra signer declared
on the TEMPLATE, or chosen per document?

---

## Branches waiting to land

| Branch | Worktree | State |
|---|---|---|
| `merge/portal-signing-consent-gate` | scratchpad `wt-consent-merge` | Merge resolved and verified, 4151 tests. Ready. |
| `feat/ticket-workspace-ops` | `wt-ticket-workspace` | Blocked on the migration above. |

---

## The signing bug, and what is actually proven

The reported defect was "I sign on my phone, I get the thank you, but I do not
see it on the rendered form on the laptop". Four diagnoses were wrong before the
right one: the release gate, a 403 from a probe with fake ids, a pdf worker that
was never the problem, and a starved rebuild debounce that was real but was not
this.

**The cause**, one statement in `lib/mark-handoff-queries.ts:collectMarkForOwner`:

```js
.update({ collected_at: ..., mark_png: null })   // nulls it
.select('mark_png')                              // reads it back
```

`UPDATE ... RETURNING` reports the row AFTER the statement, so the read-back was
the null it had just written. The function returned "no mark yet" while stamping
`collected_at`, and `collected_at` is what makes the mark unreachable. **Every
phone signature was destroyed by the act of collecting it.** Introduced by
`998661e3`, whose comment asserted the statement read what it cleared.

Fixed in `ab1b7e7c` by ordering it read, then claim, then return the bytes the
read produced.

**NOT VERIFIED: no QR has been scanned with a real phone since the fix.** It was
exercised with a fake mint and a fake poll. That test is still owed, and it is
the only thing that settles it. Test with a hard reload (Shift-Cmd-R): the
service worker is cache-first, so a normal reload can serve the old bundle
indefinitely.

**Residual risk the owner should rule on:** the invariant now holds at the query
layer, but a response lost in the NETWORK after the claim still loses the mark.
Closing that needs acknowledged delivery, which would keep the PNG at rest and
undo the `998661e3` security fix. Durability of a signature versus not storing
signature images. Nobody has made that call.

---

## An open security gap, found late and untouched

`submitTemplateForApprovalAction` and `resubmitTemplateSubmissionAction` **never
refuse a missing `signatureIntentAt`.** `recordSignature` does
`Boolean(input.signatureIntentAt)`, stores null, and the submission lands. That
is the identical defect `60a0afb6` fixed for `/api/firm/mark`, sitting on a
sibling public endpoint. A document can be submitted as signed with no
affirmation of intent recorded, which is the element that makes a mark a
signature under 15 USC 7006(5) and UETA 2(8).

Spun out as its own task rather than folded into unrelated work.

---

## Where the design rules now live

`docs/DESIGN.md` is the written spec for the marketing site and the employee
portal, and it is grounded in defects this repository has paid for rather than
in generic advice. The decision behind it: keep the identity (forest, cream,
gold are already tokens and already learned), write the rules. The reference the
owner supplied, styles.refero.design, turned out to be a gallery of about twenty
separate specifications rather than one look; averaging it would have produced
exactly the templated result the request was trying to avoid.

Counsel and HQ shells are deliberately out of that scope.

Not yet applied to the marketing homepage. `app/page.tsx` is 1,323 lines and
`components/marketing/` is already composable, so do it a section at a time,
hero first, with sign-off on that one section before the rest.

---

## Two engineering rules earned today

### Render the artifact and look

**Nine** defects were found by rendering a page, every one of them green across
the full suite:

- A sheet clipped a definition of Confidential Information mid-sentence.
- Six canvases sat at their 300x150 default having never been painted, inside a
  deck reporting "Page 1 of 6" that looked finished.
- Thumbnails showed the top-left corner of each page instead of the page.
- A refusal SENTENCE rendered in a display `<h1>`, seven lines of huge serif.
- The zoom-out shipped to the wrong component and did not exist on the page it
  was asked for.
- A reminder ran 106px past its column, so its Set button was invisible and the
  reminder could not be set at all.
- The accent was claimed seven times on one route.
- "Signature options turn on once you tick the box" rendered beside a COMPLETED
  signature.
- `document` fires `pointerleave` continuously at clientX 5, inside a 6px edge
  zone, so a sidebar reveal worked once by a race and then never, with 25 tests
  green.

The suite proves the wiring. Only the rendered page proves the reader sees the
right thing.

### A guard can be satisfied by its own documentation

Source-reading tests keep passing because the comment explaining the fix
contains the string the guard searches for. Strip comments before matching,
`{/* */}` included, and **mutate the source to confirm the test goes red**.
Reading the guard is not enough; several read correctly and proved nothing. One
agent proved its guards honestly by deleting every line of code and leaving only
the comments, which failed six assertions.

Two related traps found today:

- A guard matched an `import` rather than a CALL, so it passed while the
  imported helper sat unused and the logic was replaced by a guess.
- `ringColor.DEFAULT` written as the plain string `'var(--border)'` builds green
  but is run through `withAlphaValue`, which cannot parse a bare `var()` and
  silently substitutes Tailwind's blue. It must be a function. The first attempt
  changed one blue to a lighter blue and read like a fix.

---

## The mistake that cost the most

Three claims of "pushed to production" shipped nothing.

The `CounselOptics-pa` checkout is itself a linked worktree and was on
`feat/ticket-service-desk-layout`, not `main`. So `git log --oneline -1` showed
that branch's HEAD and read exactly like main. Merges landed on the branch, and
`git push origin main` pushed the local `main` REF, still at the old commit. It
succeeded silently. **A no-op push is indistinguishable from a real one in its
output.**

A subagent caught it, and only because its brief named a SHA that did not match
what it found.

`git log` answers "what is HEAD". Only `origin/main` answers "what is deployed".

---

## Method note

Delegating to subagents with fresh context outperformed continuing in a
depleted one, measurably. Agents found: the cross-role permission asymmetry, the
`UPDATE ... RETURNING` root cause, that the nine requested ticket statuses share
nothing with the seven that exist and would have broken `lib/intake-lanes.ts`
and a live external API, the unconfigured Tailwind border default, that
`border-*/12` and `divide-*/8` emit NO RULE AT ALL because Tailwind only
generates opacity modifiers present in `theme.opacity`, and the worktree error
above.

Two of them corrected briefs that were wrong on a point of fact. One refused a
production RLS change that was not its to make. Give them the evidence, the
constraints, and permission to stop and ask.

One operational lesson: two agents in the same working tree collided and one
lost an hour recovering. Give every agent its own `git worktree`.

## Housekeeping

`preview_start` resolves `advottic-dev` from the PARENT directory's
launch.json, which runs the sibling `CounselOptics` checkout, and new routes
404 in a way that reads as a routing bug. The correct entry for
`CounselOptics-pa` is `advottic-images`.

Signature ink is near-invisible in dark mode on the existing pad (`#0f2d24` on
`forest-950`), on both the employee form and the outside signer's page.
Pre-existing, spun out as its own task.
