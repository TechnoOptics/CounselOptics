# Engineering learnings

Lessons this codebase paid for. Each entry is a real incident with the
evidence, not general advice. Read the headings before starting work that
resembles one.

New entries go at the top with the date they were paid for.

---

## 2026-08-15 · Check the target, and check main, before you believe anything

One day produced three separate instances of the same shape: **work was
about to be done on something that either already existed or was never
broken.** Two were caught, one only after the fix had been written.

### 1. A measurement against the wrong build

`scripts/test/rendered-contrast-audit.mjs` defaulted to
`http://localhost:3000` and was pointed at `next dev`. Dev's served
stylesheet does not carry the `html:not(.dark)` repaint layer from
`app/globals.css`, so every `text-ink-400` and `text-gold-700` rendered its
raw Tailwind value. The audit correctly measured what it was shown:

    dev    2942 runs measured,  372 below the AA floor
    prod   3083 runs measured,    0 below the AA floor

The same sweep, the same hour, against production: clean on all fourteen
public routes. About 250 call-site edits had already been written to "fix"
a defect that did not exist, and were thrown away. A comment recording the
wrong number had already been committed and had to be corrected.

**What changed.** The audit now checks for the repaint layer as a
PRECONDITION and refuses a build that lacks it, naming each missing piece,
rather than measuring it. Its default target moved to production, because
the old default pointed at the one build that cannot answer the question.

**The rule.** Establish whether a tool's failure is loud or silent BEFORE
believing its output. A measurement against the wrong build is not a
measurement, and a confident number is the most expensive kind of wrong.

### 2. A branch that would have reverted a better fix

`fix/unchecked-supabase-writes` carried three commits. One of them,
"Stop losing paid token grants when the credit write fails", was already on
`main` in a **stronger** form: `main` had grown `classifyCreditWrite`, which
distinguishes a write that provably did not land from one whose response was
lost, and `releaseClaim`, which reports a failed release rather than
swallowing it. Merging the branch wholesale would have replaced that with
the earlier, cruder version.

Only the two commits `main` genuinely lacked were cherry-picked. `git branch
--no-merged` measures SHA reachability, not content, so it says nothing
about whether the *fix* is already there.

### 3. A security property that was already enforced

Before building "the QR may only be scanned once", a check found
`lib/mark-handoff-queries.ts` already updating conditionally on
`consumed_at IS NULL` and reading the row back, so a second scan loses the
race. `used_at` and `expires_at` were there too. The feature would have been
rebuilt on top of itself.

### The habit this buys

Before building or fixing, spend the two minutes on:

- **Does it already exist?** `grep` `main` for the symbol, the table
  column, the copy string. Not the branch name, and not the commit
  subject: the behaviour.
- **Is the thing I measured the thing we ship?** Dev builds, preview
  builds and production differ in CSS layering, minification and env. Name
  the target in the report.
- **If a branch claims to fix X, is X still broken?** Reproduce first.
  A branch is a claim about the past, not about now.

Related, and the same family:

- `docs/compliance/policies/vendor-and-subprocessor-management.md` records
  a latent-not-live exposure that was first escalated as live.
- The repository has repeatedly shipped guards that assert an identifier
  *appears* rather than that a value *reaches the render*. A test that
  cannot fail is the same failure as a measurement of the wrong build.

---

## A guard can be satisfied by its own documentation

Twice on 2026-08-15 a source-reading test was green while proving nothing, both
times because a COMMENT contained the string the test searched for.

`tests/signature-datetime.test.ts` banned `toISOString().slice(0, 10)` and then
failed against correct code, because the comment explaining the fix quoted the
banned expression. That direction is noisy and gets noticed.

The other direction is silent, and it shipped. `tests/document-pagination.ts`
requires `components/DocumentSheets.tsx` to render the attribute that
`form-fill-client.tsx` queries for, so a rename on one side cannot pass. It was
mutated to check, and it **passed** with the attribute renamed: the comment
above the element still spelled the old name.

This house style writes long explanatory comments next to fixes, so the comment
almost always contains the string the guard is about. That style and this test
style are in direct conflict, and the comment wins by default.

Strip comments before matching, `{/* */}` included for JSX. Then mutate the
source and watch the test go red. Reading the guard is not enough: both of
these read correctly.
