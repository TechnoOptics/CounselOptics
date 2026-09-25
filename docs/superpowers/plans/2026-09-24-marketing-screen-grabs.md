# Real screen grabs on the marketing site: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put generated screenshots of the real signed-in app onto the home, features and enterprise pages, captured from a seeded demo database that can never be production.

**Architecture:** A local Supabase stack seeded with two invented matters; a capture script that signs in by minting a one-time link with the service-role key, drives the real routes in headless Chrome and writes PNGs plus a manifest; a `Screen` primitive that renders a frame inside the existing `Sheet`; and a guard that fails the build when an image, a route or its alt text goes missing.

**Tech Stack:** Next.js App Router, Supabase (local stack via `supabase/config.toml`), puppeteer-core with the system Chrome, vitest, Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-24-marketing-screen-grabs-design.md`. Read it before Task 1.
- No em dashes, en dashes, emoji or curly quotes anywhere: code, copy, comments, docs, commit messages. Sweep staged changes with a checker written to a scratch file from `\u` escapes, never typed on a command line, and prove the control fires.
- No frame may be captured from production. The capture script refuses a target whose Supabase URL is not localhost, as a precondition rather than a warning.
- No new publicly reachable sign-in bypass. `app/api/auth/review-login/route.ts` keeps its single App Store purpose and is not touched.
- Gold appears once per page and only through `Stamp`. Four faces only (`font-caslon`, `font-caslon-text`, `font-public`, `font-courier`). No browser chrome, URL bar, device frame or gradient around any image.
- Nothing under `app/counsel`, `app/portal`, `app/hq`, `app/cases`, `app/sign` or `app/example` changes. This plan reads those screens; it never edits them.
- Every guard reads comment-stripped source via `tests/support/strip-comments.ts` and is mutation-proven before its commit, with the red output recorded.
- Four gates before every commit, each to a file with a true exit code: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run test:audit-guards`.
- Commits via `git commit -F <file>`, subject under 72 characters, body saying why, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Push after each task.
- Branch `docs/marketing-screen-grabs` in `/Users/technooptics/Advottic/wt-case-file`. Never touch `/Users/technooptics/Advottic/CounselOptics`. Never `git add .superpowers/`. Never bare `git stash`: the stack is shared and holds other sessions' work.

---

### Task 1: The local stack and a demo it can hold

**Files:**
- Create: `supabase/config.toml`
- Create: `scripts/demo/seed-demo.mjs`
- Create: `docs/DEMO-CAPTURES.md`
- Test: `scripts/demo/seed-demo.test.mjs`

**Interfaces:**
- Produces: `seedDemo({ url, serviceKey })` returning `{ person: { email, caseId }, firm: { email, matterId } }`. Tasks 2 and 3 consume both ids.

- [ ] **Step 1: Write the failing test**

```js
// scripts/demo/seed-demo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from './seed-demo.mjs';

test('refuses a target that is not local', async () => {
  await assert.rejects(
    () => seedDemo({ url: 'https://abc.supabase.co', serviceKey: 'x' }),
    /local/i,
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test scripts/demo/seed-demo.test.mjs`
Expected: FAIL, cannot find module `./seed-demo.mjs`.

- [ ] **Step 3: Write the refusal and the seed shell**

`seed-demo.mjs` exports `seedDemo`. Its first statement throws when the URL's
hostname is neither `localhost` nor `127.0.0.1`, with a message naming the
rule: a demo seed never runs against a database that might hold real matters.
Everything after that is the insert path, using
`@supabase/supabase-js` with the service-role key.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test scripts/demo/seed-demo.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the local stack**

`supabase/config.toml` for `supabase start`, with the API on 54321 and the
database on 54322. Read `supabase/schema.sql` and the `supabase/migrations`
directory to confirm the stack applies them; record in the report which
command applies the schema and its exit code.

- [ ] **Step 6: Seed the two matters**

The person's account holds **Ramirez v. Oakline Rentals**, matching the home
page's sheet exactly: exhibits A to D named `Signed lease agreement.pdf`,
`Move-out photos (kitchen).jpg`, `Text: "deposit next week".png` and
`Itemized deduction letter.pdf`, dated Jan 3 2024, Mar 30 2025, Apr 6 2025 and
Apr 9 2025, with a hearing. The firm's account holds the trade-secrets matter
the enterprise page names. Every name is invented. Read
`app/page.tsx` and `app/enterprise/page.tsx` for the exact strings and copy
them rather than inventing near-misses.

- [ ] **Step 7: Document it**

`docs/DEMO-CAPTURES.md`: what the demo contains, how to start the stack, how
to seed, and the rule that captures never point at production.

- [ ] **Step 8: Gates, sweep, commit, push**

---

### Task 2: Signing in without a new public door

**Files:**
- Create: `scripts/demo/sign-in.mjs`
- Test: `scripts/demo/sign-in.test.mjs`

**Interfaces:**
- Consumes: `seedDemo`'s returned emails.
- Produces: `signInAs(page, { url, serviceKey, email })`, which leaves the
  puppeteer `page` holding an authenticated session. Task 3 calls it once per
  account.

- [ ] **Step 1: Write the failing test**

```js
// scripts/demo/sign-in.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInAs } from './sign-in.mjs';

test('refuses a target that is not local', async () => {
  await assert.rejects(
    () => signInAs({}, { url: 'https://abc.supabase.co', serviceKey: 'x', email: 'a@b.test' }),
    /local/i,
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test scripts/demo/sign-in.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`signInAs` carries the same non-local refusal, then calls
`supabase.auth.admin.generateLink({ type: 'magiclink', email })` with the
service-role key and navigates the page to the returned link. This is the
mechanism the branded sign-in email already uses, so no new route is added and
`app/api/auth/review-login/route.ts` is not touched.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Prove a real session end to end**

Against the seeded local stack, sign in and assert the page reaches
`cases/[id]` rather than `/sign-in`. Record the run and its exit code.

- [ ] **Step 6: Gates, sweep, commit, push**

---

### Task 3: The capture script and its manifest

**Files:**
- Create: `scripts/demo/capture-screens.cjs`
- Create: `public/screens/manifest.json` (written by the script)
- Modify: `package.json` (add `demo:capture`)

**Interfaces:**
- Consumes: `signInAs`, and the ids from `seedDemo`.
- Produces: PNGs under `public/screens/`, and a manifest whose entries are
  `{ id, route, width, theme, alt, commit }`. Tasks 4, 5 and 6 read `id` and
  `alt`; Task 7's guard reads every field.
- **Filename convention, binding:** each entry's image is
  `public/screens/<id>.png`, exactly the entry's `id` and nothing else.
  `Screen` (Task 4, already built) derives intrinsic width and height by
  reading that file's PNG IHDR chunk, because the manifest carries no height.
  A capture script that names files any other way breaks `Screen` with a raw
  ENOENT rather than a useful error. This was discovered in Task 4's review
  and written here because a convention that lives only in a task report is
  a convention the next implementer does not have.

- [ ] **Step 1: Write the failing manifest test**

```js
// in scripts/demo/capture-screens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestEntry } from './capture-screens.cjs';

test('an entry records the commit it was taken from', () => {
  const e = manifestEntry({ id: 'case-file', route: '/cases/1', width: 1440, theme: 'light', alt: 'A case file listing four exhibits.' });
  assert.match(e.commit, /^[0-9a-f]{7,40}$/);
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement the script**

Modelled on `scripts/design/render-marketing.cjs`: puppeteer-core with the
system Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, reduced motion
emulated, a base URL and an output directory as `process.argv`. It refuses a
non-local Supabase target before opening a browser. It signs in per account,
visits each route, screenshots at the agreed widths, and writes the manifest
with `git rev-parse HEAD` as `commit`.

Routes, from the spec: `/cases/[id]`, `/cases/[id]/timeline`,
`/cases/[id]/packet`, `/counsel/cases/[id]`, `/counsel/cases/[id]/evidence`,
`/counsel/cases/[id]/timeline`.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Capture for real and look**

Run the full capture against the seeded stack. Open at least the home hero and
one firm frame with the Read tool and say what they show. A capture nobody
looked at is the failure mode this whole plan exists to avoid.

- [ ] **Step 6: Wire `demo:capture` into package.json**

- [ ] **Step 7: Gates, sweep, commit, push**

---

### Task 4: The Screen primitive

**Files:**
- Create: `components/marketing/file/Screen.tsx`
- Modify: `components/marketing/file/index.ts`
- Test: `tests/marketing-file-primitives.test.tsx`

**Interfaces:**
- Consumes: the manifest's `id` and `alt`.
- Produces: `<Screen id="case-file" caption="The case file" />`, which renders
  the manifest's image inside `Sheet` with intrinsic dimensions and a Courier
  caption. Tasks 5 and 6 use only this.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders alt text from the manifest and never the word screenshot', () => {
  const { container } = render(<Screen id="case-file" caption="The case file" />);
  const img = container.querySelector('img');
  expect(img?.getAttribute('alt')).toBeTruthy();
  expect(img?.getAttribute('alt')?.toLowerCase()).not.toContain('screenshot');
  expect(img?.getAttribute('width')).toBeTruthy();
  expect(img?.getAttribute('height')).toBeTruthy();
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement**

`Screen` reads the manifest at build time, renders `next/image` inside `Sheet`
with no rounded corners beyond `Sheet`'s own, no shadow, no frame, and the
caption in `LABEL`. It throws at build time when `id` is not in the manifest,
so a typo fails the build rather than rendering a hole.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Gates, sweep, commit, push**

---

### Task 5: The home hero

**Files:**
- Modify: `app/page.tsx`
- Test: `tests/exhibit-row-shows-the-whole-name.test.ts`

- [ ] **Step 1: Place the frame**

Put `<Screen id="case-file" caption="A case file, four exhibits in" />` where
the cover's typographic sheet now sits, so the sheet and the screenshot show
the same matter. Read the file first: the cover's two-track grid and the
`pb-24 sm:pb-24` stamp reservation are both load-bearing and explained in
comments that must survive.

- [ ] **Step 2: Render and read it**

`npm run design:render` against a local `next start`, then open the home
captures at 1440 and 390 with the Read tool. The frame must not push the
headline below the fold at 1440, and must not overflow at 390.

- [ ] **Step 3: Gates, sweep, commit, push**

---

### Task 6: The features sequences and the enterprise frame

**Files:**
- Modify: `app/features/page.tsx`
- Modify: `app/enterprise/page.tsx`

- [ ] **Step 1: Place the consumer sequence**

Three frames in workflow order under the consumer half, each with a caption
naming the step: the case file, the timeline, the packet.

- [ ] **Step 2: Place the firm sequence**

Three frames under the firm half: the matter, its evidence, its timeline.

- [ ] **Step 3: Place the enterprise frame**

One wide frame of the firm workspace on `app/enterprise/page.tsx`. Read the
file first: its cover carries `enterprise-shell`, whose token remapping is
why the sheet there needs `tone="dark"`.

- [ ] **Step 4: Render and read both pages**

Light and dark, 1440 and 390. Say what the captures show. Confirm the gold
stamp is still the only gold on each page.

- [ ] **Step 5: Gates, sweep, commit, push**

---

### Task 7: The guard that keeps it honest

**Files:**
- Create: `tests/screens-are-real-and-current.test.ts`
- Modify: `.github/workflows/` (the workflow that runs the marketing guards)

- [ ] **Step 1: Write the failing guard**

Comment-stripped source, in the shape of `tests/exhibit-row-shows-the-whole-name.test.ts`, asserting:

1. every `<Screen id="...">` in `app/**` has an entry in the manifest;
2. every manifest entry's `route` resolves to a `page.tsx` in `app/`;
3. every entry has non-empty `alt` that does not contain "screenshot";
4. every entry has a `commit`.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Make it pass**

- [ ] **Step 4: Mutate it four times, once per assertion**

Record each red output verbatim: an unknown `id`; a manifest route renamed; an
alt emptied; a commit removed. Restore after each.

- [ ] **Step 5: Wire it into CI**

Add it beside the existing marketing guards. Validate the YAML parses.

- [ ] **Step 6: Gates, sweep, commit, push**

---

### Task 8: The refresh path, and proving it on production

**Files:**
- Modify: `docs/DEMO-CAPTURES.md`
- Modify: `package.json`

- [ ] **Step 1: One command refreshes everything**

A `demo:refresh` script that starts the stack, seeds, captures and reports
what changed, so a refresh is one command rather than a remembered sequence.

- [ ] **Step 2: Record the residue**

Document plainly what no guard catches: a screen can change cosmetically
without changing its route, and only a scheduled refresh plus a human reading
the diff will notice.

- [ ] **Step 3: Open the pull request**

Base `main`, head `docs/marketing-screen-grabs`. The body says what shipped,
which routes are captured, and that captures cannot reach production. No
"Generated with Claude Code" footer, per the owner's global rule, and say in
the report that it was omitted.

- [ ] **Step 4: After merge, render production and read it**

Point `scripts/design/render-marketing.cjs` at `https://advottic.com` and open
the home, features and enterprise captures. The lesson of 2026-09-22 is that a
local audit reported zero truncation while production showed twelve, because
the fonts differ. A deploy is not verified until the deployed origin has been
photographed and looked at.

---

## Self-review

**Spec coverage.** Section 2's per-page placement: Tasks 5 and 6. Section 2's
presentation rules: Task 4. Section 3's demo data: Task 1. Section 3's
sign-in: Task 2. Section 3's capture script and production refusal: Tasks 2
and 3. Section 4's manifest and guard: Tasks 3 and 7. Section 4's refresh:
Task 8. Section 5's local stack: Task 1. Section 6's risks: the production
refusal is in Tasks 1, 2 and 3; staleness in Task 7; page weight in Tasks 4
and 5. Section 7 is out of scope and no task touches it.

**Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N".
Every code step carries its code. The one place a task says "read the file
first" is followed by exactly what to look for and why.

**Type consistency.** `seedDemo` returns `{ person, firm }` in Task 1 and is
consumed under those names in Tasks 2 and 3. `signInAs(page, opts)` keeps its
signature in Tasks 2 and 3. A manifest entry is `{ id, route, width, theme,
alt, commit }` in Task 3 and every field is read under that name in Tasks 4
and 7. `Screen` takes `id` and `caption` in Tasks 4, 5 and 6.

**Known gap, deliberate.** The capture widths are named as "the agreed widths"
in Task 3 rather than fixed numbers, because the render audit's own 1440 and
390 are the obvious choice but the firm workspace may need a third. The
implementer picks and records them in Task 3, and Task 7's guard pins whatever
they chose.
