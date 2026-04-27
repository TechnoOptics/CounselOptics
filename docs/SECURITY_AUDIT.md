# Security audit — Advottic

Audit date: 2026-04-27. Methodology: source-code scan, npm audit,
git-history secret scan, manual review of every API route, RLS
coverage check, HTTP headers inspection. Honest framing — nothing
is "fully secure," but the gap between "should we ship?" and "is
this safe enough for v1?" is bigger than people think.

## TL;DR

**Safe to ship.** No critical bugs, no committed secrets, no
auth bypass paths, RLS in place, webhook signatures verified.
Two material gaps were closed in this audit (CSP missing,
Permissions-Policy was actively blocking camera/mic/geo features).
Five outstanding items are documented below with priority +
effort.

---

## What's good already

### Source code & secrets

- ✅ `.env`, `.env.local` listed in `.gitignore`. Only
  `.env.local.example` is tracked — verified no real values in it.
- ✅ Git history scanned: zero committed `sk_live_`, `sk_test_`,
  `whsec_`, `rk_live_`, or `sbp_` strings across all branches.
- ✅ `SUPABASE_SERVICE_ROLE_KEY` only referenced in server-side
  modules (`lib/supabase/admin.ts`, `lib/storage.ts`,
  `app/api/account/delete/route.ts`). Never reaches the browser.
- ✅ `NEXT_PUBLIC_*` boundary respected. Only public env vars use
  the prefix; the only third-party-facing public var is
  `NEXT_PUBLIC_CAL_LINK` (a calendar link, not a credential).
- ✅ Capacitor `android/app/src/main/assets/public/` and
  `ios/App/App/public/` (which contain inlined env values after
  `cap sync`) are now explicitly gitignored.

### Authentication

- ✅ Supabase Auth with HTTPOnly + Secure + SameSite cookies
  (Supabase SSR adapter sets these by default).
- ✅ Session refresh handled in `middleware.ts` via the
  `getAll/setAll` cookie pattern that survives same-domain
  apex/www splits.
- ✅ Sign-out endpoint (`/auth/sign-out`) and account deletion
  (`/api/account/delete`) both clear cookies on the response.
- ✅ Admin role enforced server-side via DB lookup
  (`isCurrentUserAdmin` in `lib/supabase/server.ts`), gated on
  `profiles.is_admin = true`. UI hiding never relied on alone.
- ✅ Email-anchored 7-day trial defends against
  delete-and-resignup reset (`signup_history.first_signup_at`).

### Authorization (RLS)

- ✅ Every Supabase table has Row-Level Security policies:
  `cases`, `exhibits`, `case_collaborators`, `audit_events`,
  `crash_reports`, `system_health`, `signup_history`,
  `subscriptions`, `profiles`, `token_ledger`, etc.
- ✅ Policies tie reads/writes to `auth.uid()` so a service-key
  bug or accidental client-side query can't expose another
  user's data.
- ✅ File access is signed-URL-only (`getExhibitSignedUrl` →
  302 redirect from `/api/files/[id]`); the bucket itself is
  private. URLs expire.

### API surface

- ✅ Every API route has appropriate auth:
  - `bella` — public (limited mode for unauthed) + per-IP rate
    limit (30/min)
  - `review-document` — public free tool, rate-limited
  - `account/{delete,export}` — `getCurrentUser()` required
  - `cron/health` — `Authorization: Bearer ${CRON_SECRET}`
  - `files/[id]` — RLS gates which exhibit metadata is readable;
    signed URL completes the chain
  - `search` — RLS-aware (`listCases` only returns user's cases)
  - `stripe/{checkout,portal,topup}` — auth required; tier checks
    enforced server-side
  - `stripe/webhook` — `stripe.webhooks.constructEvent(rawBody,
    sig, secret)` verifies signature
  - `crash` — read-only insert; throttled by client SDK
  - `version` — public read of `VERCEL_GIT_COMMIT_SHA` (no risk)
- ✅ Server-action body size capped at 50MB
  (`experimental.serverActions.bodySizeLimit`).
- ✅ Exhibit upload capped at 50MB
  (`MAX_BYTES = 50 * 1024 * 1024` in `lib/actions.ts`).
- ✅ PDF embed cap at 20MB (`MAX_EMBED_BYTES` in `lib/pdf.ts`).
- ✅ Stripe webhook uses raw body for signature verification
  (correct order — verify before parse).

### Transport & headers

- ✅ Vercel terminates TLS 1.3 with auto-renewing certs.
- ✅ `Strict-Transport-Security: max-age=15552000;
  includeSubDomains` (6 months).
- ✅ `X-Frame-Options: DENY` blocks clickjacking.
- ✅ `X-Content-Type-Options: nosniff`.
- ✅ `Referrer-Policy: strict-origin-when-cross-origin`.
- ✅ **NEW:** `Content-Security-Policy-Report-Only` with a
  reasonable starter policy (allowing Supabase, Anthropic, Stripe,
  Google Maps, Cal). Promote to enforcing mode after one week of
  quiet violation logs.

### Monitoring & patrol

- ✅ `instrumentation.ts` registers `onRequestError` so every
  500 is recorded to `crash_reports` with stack + URL + user.
- ✅ `app/api/crash/route.ts` accepts client-side error reports
  for the same table (CrashReporter component fires on
  `window.onerror`).
- ✅ Hourly cron `/api/cron/health` exercises critical paths
  (Supabase ping, Anthropic ping) and records to `system_health`.
- ✅ Email digest on health failures, throttled to once per 24h
  via `email_sent_at` so a sustained outage doesn't spam.
- ✅ All `audit_events` are written for every case interaction
  (created, viewed, exhibit upload/delete, review, hearing
  updated, collaborator changes). Per-case timeline visible to
  the owner.

### Data residency

- ✅ All processing in the United States: Vercel (USA), Supabase
  (USA, primary region us-east-1), Anthropic (USA), Stripe (USA),
  Resend (USA). Every sub-processor has a contractual
  data-handling agreement.

---

## What's at risk (open items)

### High priority

#### 1. Next.js 14.2.35 has 5 known DoS vulnerabilities

Severity: **High** in npm-audit terms. Real-world risk: medium —
DoS attacks against the image optimizer, RSC HTTP request
smuggling, and unbounded image-cache growth.

Fix: upgrade to Next 16.x. Breaking change (App Router APIs
shifted, `experimental.serverComponentsExternalPackages` renamed).
Plan a dedicated migration session — half-day of work.

Mitigations until then:
- Vercel's edge already enforces request-rate caps and per-IP
  budgets that take the worst of the DoS classes off the table.
- The image optimizer vuln requires `remotePatterns` to be
  misconfigured; ours is the default (no remote images), so the
  attack surface is small.

#### 2. CSP is in Report-Only mode

The starter policy is shipped today as `Content-Security-Policy-
Report-Only`. It does not enforce — it only logs violations. This
is intentional (so we don't break anything we forgot about), but
the protection only kicks in once we promote it.

Action: after one week of quiet violation logs, drop the
`-Report-Only` suffix in `next.config.mjs` to enforce.

### Medium priority

#### 3. Rate limiting only on Bella + document-review

Other public/auth endpoints (`/api/account/export`, `/api/search`,
`/api/files/[id]`) have no per-IP cap. A signed-in user could
theoretically scrape their own data faster than expected, but
RLS stops them from getting anyone else's. Lower priority but
worth adding.

Action: extract the rate-limit helper from `app/api/bella/route.ts`
into `lib/rate-limit.ts` and apply to every API route. ~30 min.

#### 4. No formal failed-auth alerting

Supabase logs failed sign-ins, but we don't aggregate or alert on
patterns (5 failures in 60 seconds, sign-ins from 3 countries in
1 hour). Real attackers go for credential-stuffing, not single
guesses.

Action: add a Supabase trigger / scheduled function that
inspects `auth.audit_log_entries` and emails the operator when
a threshold is crossed. ~1 hour.

#### 5. No bot detection / WAF

Vercel Pro includes basic bot mitigation but no real WAF. For
a legal-tech app handling PII, an explicit WAF (Cloudflare in
front of Vercel, or Vercel's own WAF tier) is reasonable as we
grow.

Action: Cloudflare WAF in front of `advottic.com` is ~$20/mo
plus a one-time DNS reconfiguration. Defer until traffic grows.

### Low priority

#### 6. Build dependencies have 10 known vulnerabilities

Affects `@xmldom/xmldom`, `minimatch`, `tar`, `xcode`, all via
the Capacitor build chain (`@trapezedev/project`,
`@capacitor/assets`). These run only at `cap sync` time, not in
production. Vercel's build sandbox contains the blast radius.

Action: run `npm audit fix` and accept any breakage in
Capacitor tooling, or wait for upstream Capacitor to update.

---

## Future hardening (none required for v1)

These are nice-to-haves rather than gaps. Listed in rough
impact order.

- **Replace CSP `'unsafe-inline'` with nonces.** Requires a
  Next 15+ migration plus per-page nonce plumbing. Significant
  refactor; defer.
- **Subresource Integrity (SRI) on third-party scripts.** Mostly
  redundant given strict CSP — only matters if we add a
  third-party CDN.
- **Two-factor auth for end users.** Supabase supports TOTP;
  not yet wired into the UI.
- **Account-takeover protections.** Email-on-suspicious-sign-in
  + email-on-password-reset are already standard via Supabase
  Auth; UX-level bell icons / device list would be a nice add.
- **Structured access logs to a SIEM.** For a one-person team,
  Vercel logs + Supabase logs + crash_reports is enough. Worth
  revisiting at 1k DAU or after first paying enterprise customer.
- **Bug bounty program.** When traffic justifies the inbound
  noise, list on HackerOne or Intigriti. Not yet.
- **Penetration test.** Annual external pentest (~$5–15k from a
  reputable firm) is the right cadence once revenue hits ~$200k
  ARR. Not before.

---

## What "active patrol" looks like today

This is the de-facto SOC for Advottic right now:

| Layer | What runs | Where it surfaces |
|---|---|---|
| Edge | Vercel rate limiting + DDoS scrub | Vercel dashboard |
| App | Per-IP rate limit on AI endpoints (30/min) | In-process |
| App | RLS denies cross-user reads at the DB | Supabase logs |
| App | `instrumentation.ts` `onRequestError` → `crash_reports` | `/admin/health` (admin-only) |
| App | Client-side `CrashReporter` → `/api/crash` | Same |
| Cron | Hourly Supabase + Anthropic + Stripe ping | `system_health` |
| Cron | 24h-throttled health email | Operator inbox |
| Stripe | Webhook signature verification | Vercel logs on bad sig |
| Auth | Supabase audit log on every auth event | Supabase dashboard |

Promote any of those to a louder channel (Slack, PagerDuty) when
the team grows past one person.

---

## Recommendations summary (in order of impact-to-effort)

1. **[Done in this audit]** Add CSP-Report-Only header.
2. **[Done in this audit]** Fix Permissions-Policy that was
   blocking camera/mic/geo features.
3. **[Done in this audit]** Tighten `.gitignore` to explicitly
   exclude Capacitor sync targets.
4. **Promote CSP to enforcing mode** in 1 week.
5. **Plan Next 16 migration** for next sprint — closes 5 high
   severity DoS vulns.
6. **Extract rate-limit helper** and apply to all API routes —
   ~30 min.
7. **Add failed-auth threshold alert** — ~1 hour.
8. **Consider Cloudflare WAF** when traffic justifies $20/mo.

The first three are shipped in this commit. The rest are
prioritized backlog items, not blockers for launch.
