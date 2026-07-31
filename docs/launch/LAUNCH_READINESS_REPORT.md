Both high-severity correctness defects are confirmed in source. The verdict holds.

# Advottic Pre-Launch Readiness Report
_Lead engineer compilation, 2026-06-26_

## 1. Verdict

**GO-WITH-FIXES.** The build is clean, core consumer happy-paths are solid, and SEO/security foundations are sound, but two confirmed high-severity correctness defects (a trust-critical dead-end in the Safe Witness flagship and broken HTML entities shipping into the SOL checker UI _and_ Google structured data) plus two high-severity unauthenticated/anon-exposure security issues must land before public launch. None are architectural; all are bounded, well-understood fixes.

## 2. Prioritized punch list (deduped across all three audits)

### Critical
_None._ No defect blocks the build, corrupts data, or exposes secrets. The four "high" items below are launch-blockers but not emergencies.

### High
1. **Safe Witness stuck on 'active' screen, never reaches review/save**: `components/SafeWitness.tsx:302-312`. Confirmed: `stopAll()` calls `recRef.current?.state !== 'inactive' && recRef.current?.stop()`, so when a recorder exists but is already `inactive`, `stop()` never fires (no `onstop`/finalize) and the `if (!recRef.current)` fallback is skipped because the ref is non-null; the user is stranded with no hash, no save. **Fix:** make the transition unconditional by capturing whether a live stop was initiated and forcing `setPhase('review')` when it wasn't:
   ```
   const rec = recRef.current; let willFinalize = false;
   if (rec && rec.state !== 'inactive') { try { rec.stop(); willFinalize = true; } catch {} }
   teardown(); if (!willFinalize) setPhase('review');
   ```
2. **Raw HTML entities render as literal text in SOL checker + leak into FAQ JSON-LD**: `lib/statute-of-limitations.ts` (lines 87, 94, 124, 134, 137; confirmed via grep). `&ldquo;`/`&rdquo;`/`&rsquo;` appear as literal characters; JSX does not decode entities in JS string values, so users see `the &ldquo;discovery rule&rdquo;` in the checker (`StatuteOfLimitationsChecker.tsx:101`) and the broken text ships into FAQPage structured data (`page.tsx:49`). **Fix:** replace the sequences with real Unicode (`“ ” ’`) at the source, which corrects the checker, the FAQ schema, and the open-data feed in one place. Scan the `examples` arrays too (line 87, 137 already flagged).
3. **SECURITY DEFINER helpers anon-EXECUTE-able**: Supabase helpers. 8 SecDef helpers (incl. `is_admin`, `is_firm_member`) are anon-callable and leak facts. **Fix:** `REVOKE EXECUTE ... FROM anon, authenticated, public` and re-grant only where intended.
4. **Bella attach endpoint parses 10MB uploads unauthenticated**: `api/bella/attach`. No auth, no limit: a DoS surface. **Fix:** require auth (401 otherwise) and/or IP-based rate limit + size cap.

### Medium
5. **Public storage buckets are listable by anon**: avatars/logos. Open `select` lets anyone enumerate all objects. **Fix:** restrict policy to authed owner-prefix.
6. **Cron auth fails open**: `api/cron`. Empty secret skips the guard. **Fix:** fail closed when the secret is unset/empty.
7. **AI rate limiter is per-instance in-memory**: `api/decode`/review. Ineffective across instances. **Fix:** shared-store limiter with a hard cap.
8. **State small-claims pages omit FAQPage + HowTo schema**: `app/resources/states/[state]/small-claims/page.tsx`. 50+ high-intent pages render only Breadcrumb + LegalService; cap/fee/statute facts map cleanly to FAQ/HowTo. **Fix:** generate per-state FAQ from `STATES_SMALL_CLAIMS` and render `FaqJsonLd` + `HowToJsonLd`, mirrored as visible accordion content. _(Coordinate with item 2: fix entities first so clean copy feeds this schema.)_
9. **HowTo schema built but never rendered**: `app/resources/[slug]/page.tsx`, `lib/articles.ts`. `HowToJsonLd` has zero usages. **Fix:** add a `steps` field to `Article`, populate procedural articles, render `HowToJsonLd`.
10. **Hub pages omit ItemList; home/pricing omit aggregateRating**: `app/resources/page.tsx`, `app/compare/page.tsx`, `app/resources/states/page.tsx`, `app/page.tsx`, `app/pricing/page.tsx`. **Fix:** render `ItemListJsonLd` on the three hubs now; pass ratings only once real reviews exist (see §4).

### Low
11. **Vault vs Contracts folder-move use inconsistent Supabase clients**: `lib/folders-actions.ts:66-129`. Not a live hole (admin path verifies ownership), but a maintenance hazard. **Fix:** prefer RLS-scoped client for both, or comment the invariant + keep explicit checks.
12. **Review carousel can clip on late reflow**: `app/cases/[id]/review-panel.tsx:172-182`. **Fix:** `ResizeObserver` on the active slide and/or a min-height fallback.
13. **Footer links unreachable by keyboard until expanded**: `components/FooterCol.tsx:44`. Working-as-designed disclosure. **Fix (polish):** default columns expanded on sm+; collapse only on mobile.
14. **DB hygiene**: auth/contracts. HIBP disabled; mutable `search_path`; contracts queried by id only. **Fix:** enable HIBP, pin `search_path`, add owner checks.
15. **`fireAlert` called inside a `setCount` updater**: `components/SafeWitness.tsx:234-244`. StrictMode double-fire risk in dev. **Fix:** drive the fire from a `useEffect` watching `count===0`; keep the updater pure.

## 3. Before first marketing push
- [ ] Land High items 1–4 and verify: Safe Witness reaches review/save in the "recorder already inactive" and "tracks stopped early" paths; SOL checker + FAQ JSON-LD render clean quotes (re-validate FAQPage in Google Rich Results Test).
- [ ] Ship the SEO wins (items 8–10) **after** the entity fix, since marketing traffic lands on exactly these high-intent surfaces (50-state pages, resources, pricing). Re-submit sitemap and validate structured data on a sample of state pages.
- [ ] Close anon-exposure (items 3, 5, 6) before any traffic; these scale with attention.
- [ ] Confirm shared-store rate limiting (item 7) is live before paid acquisition drives AI usage.
- [ ] Smoke-test the 12 key public pages + a Safe Witness end-to-end recording on a real iOS shell once fixes are deployed.

## 4. Needs a human decision
- **Ratings/aggregateRating (item 10):** do NOT fabricate star ratings. Schema must reflect genuine, verifiable reviews or it risks Google penalties and erodes trust with users in legal distress. Decision needed: hold rating schema until a real review pipeline exists, or launch without it.
- **Safe Witness launch gating:** confirm whether Safe Witness is in-scope for the first marketing push at all. If yes, item 1 is a hard blocker; if it can ship dark/behind a flag, the timeline loosens.
- **iOS blank-launch fix (from memory):** the App Store 2.1 blank-screen rejection fix (React #419 + staged watchdog) is noted as not yet deployed. Confirm whether this report's launch assumes that fix is live, since it gates the iOS shell entirely.
- **Bella attach throttling policy (item 4):** product call on auth-required vs. anon-with-IP-limit, since it affects the unauthenticated try-before-signup funnel.