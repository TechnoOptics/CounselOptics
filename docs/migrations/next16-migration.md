# Next.js 14 → 16 migration scope

**Status:** scoped, not started · **Owner:** _tbd_ · **Trigger:** the `next` HIGH advisory
(Image Optimizer DoS) has **no 14.x or 15.x patch**, and `npm audit` resolves the fix to
`next@16.2.10` (semver-major). So the `Security audit` CI gate stays red until we land Next 16.
This is a framework migration (14 → 15 → 16 + React 19), **not** a drop-in bump, hence a
scoped, tested effort on its own branch rather than folded into a dependency PR.

## Target versions

| Package | From | To |
|---|---|---|
| `next` | 14.2.35 | 16.2.10 |
| `react` / `react-dom` | 18.3.1 | 19.x (required by Next 15+) |
| `@types/react` / `@types/react-dom` | 18.3.x | 19.x |
| lint | `next lint` | ESLint CLI (`next lint` removed in 16) |

Runtime: Next 16 needs Node ≥ 20.9. CI runs 22, local 24. ✔ no change.

## Breaking-change inventory (measured against this repo)

### 1. Async request APIs: **biggest surface, mostly codemod-able**
`cookies()`, `headers()`, `draftMode()`, and `params` / `searchParams` became async in 15 and
sync access is **removed** in 16.
- **35 `cookies()`/`headers()` call sites across 25 files.**
- **65 files** type `params`/`searchParams` in `page.tsx` / `layout.tsx` / `route.ts`
  (162 pages, 87 route handlers, 4 layouts, 15 `generateMetadata` with params).
- The official codemod handles the bulk:
  `npx @next/codemod@16 next-async-request-api .`
- **Supabase cookie adapter** is the main hand-fix: `createServerClient` cookie wiring lives in
  `lib/supabase/server.ts` (1 `cookies()` site) and `lib/supabase/middleware.ts`. `@supabase/ssr`
  is already `^0.10.2` (async-cookies aware), so this is a small, centralized change, not spread
  across the app.

### 2. React 19: **low third-party risk (unusual, in our favor)**
The only React-ecosystem dependencies are `react` / `react-dom` themselves: **no Radix,
react-hook-form, framer-motion, lucide, @tanstack, supabase auth-ui, etc.** So the usual
"every UI lib needs a React 19-compatible release" blocker mostly doesn't apply. Still verify:
`ref`-as-prop / `forwardRef` changes, `useFormState` → `useActionState`, and any `propTypes`.

### 3. `next.config.mjs` changes: **small, known edits**
- `experimental.serverComponentsExternalPackages: ['pdfkit']` → top-level **`serverExternalPackages`**.
- Remove `experimental.instrumentationHook` (instrumentation is stable / default-on).
- `experimental.serverActions.bodySizeLimit` → `serverActions` graduated out of `experimental`.
- `images.remotePatterns` already in use (no `images.domains`). ✔ nothing to migrate there.
- No custom `webpack()` function → **Turbopack-as-default (16) is low-risk**; keep a `--webpack`
  fallback ready if the CSP/inline-script bootstrap misbehaves.

### 4. Caching-default change: **largely moot here**
15 flipped `fetch` and GET route handlers to uncached-by-default. **184 routes are already
`export const dynamic = 'force-dynamic'`** and there is **no `unstable_cache`**, so most of the
app is already opted out of caching. Spot-check only the `force-static` (24) and `revalidate`
(5) routes.

### 5. Edge runtime: **verify**
**16 routes use `export const runtime = 'edge'`.** Confirm they still build/run under 16, and
clean up the pre-existing `edge` + `force-static` conflict warnings on the `.well-known/*` routes
seen in current builds.

### 6. `next lint` removed (16)
The `lint` script is `next lint`. Migrate to the ESLint CLI (add `eslint` + a flat config, or
Biome) and update the script + any CI usage.

### Confirmed NON-issues (absent from this repo)
`images.domains`, `next/legacy/image`, `@next/font`, AMP, `NextRequest.geo`/`.ip`, custom server.

## Phased plan (own branch: `chore/next-16`)

- **Phase 0 (deps):** bump next/react/react-dom/@types on the branch; `npm install`; expect it to
  not build yet.
- **Phase 1 (codemod):** run `@next/codemod@16 next-async-request-api`; review every diff (codemod
  is good but not perfect on destructured/aliased params).
- **Phase 2 (hand-fixes):** Supabase cookie adapter (`lib/supabase/server.ts`, `middleware.ts`);
  `next.config.mjs` edits (§3); `useFormState`→`useActionState` if present; lint migration (§6).
- **Phase 3 (verify):** `tsc --noEmit` → `next build` (try Turbopack, fall back to `--webpack` if
  needed) → `npm run test:audit-guards` (our guards) → `npm test` (vitest). Smoke-test the flagship
  flows: counsel dashboard + a couple detail pages, consumer sign/case flow, **auth (Supabase
  cookies): sign-in/out/session**, and the 16 edge routes.
- **Phase 4 (mobile):** confirm the Capacitor iOS/Android web build still packages (no `output:`
  override today; verify how the wrappers consume the build) before cutting any app release.
- **Phase 5 (optional follow-up):** CSP nonces for `script-src` (already flagged in `next.config.mjs`
  as a "future Next 15+" item) now that the framework supports it cleanly.

## Risk & effort

- **Effort:** ~1–2 focused days. The async-API codemod does most of the 35 + 65 sites; the residual
  is Supabase cookies, config, lint, and verification.
- **Risk drivers:** async-cookies auth wiring (highest; gate on a real sign-in/out test),
  edge-route compat, and Turbopack build. **De-risked by:** minimal React-ecosystem surface,
  no `unstable_cache`, already-dynamic routes, centralized Supabase client.
- **Rollback:** branch-isolated; `main` is untouched until a verified merge.

## Definition of done
`next build` green on Turbopack (or documented `--webpack`), `test:audit-guards` + `vitest` green,
auth + flagship flows smoke-tested, **and `npm audit --audit-level=high` no longer flags `next`**
(the original trigger). The Capacitor mobile toolchain highs remain a separate track.
