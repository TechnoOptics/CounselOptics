# Sign in with Apple failure — diagnosis

App Review rejection, 2026-07-29, Guideline 2.1(a), build 22:

> The app exhibited one or more bugs that would negatively impact users.
> Bug description: An error occurred when signing in with Apple.
> Review device: iPhone 17 Pro Max, iPad Air 11-inch (M3), iOS/iPadOS 26.6.

Investigated 2026-07-31. All evidence below is reproducible: live probes
of Apple's and Supabase's endpoints, plus read-only queries against the
production Supabase project `hpmtlhpyvbreyfimftgt`.

---

## 1. Summary

Sign in with Apple gets **all the way through Apple and all the way
through Supabase, and then dies on the last hop back into the app.**

Supabase minted a valid PKCE auth code for the reviewer twice on
2026-07-29. It created their user record. It never created a session,
because the app never received the code and therefore never called
`exchangeCodeForSession`.

The client secret is fine. The Service ID is fine. The redirect URLs are
fine. MFA is not involved. The break is in the return path from the
in-app Safari sheet to the app.

---

## 2. What the production database says

The decisive evidence. `auth.flow_state` rows for the review window:

| flow_state id | provider | created | auth_code_issued_at | PKCE |
|---|---|---|---|---|
| `cd612291-029a-4c0f-8567-077b8adce79d` | apple | 2026-07-29 05:59:04Z | **2026-07-29 05:59:27Z** | s256 |
| `3d07fcd8-a3f7-4a5c-ba6e-65053a74ae75` | apple | 2026-07-29 05:59:51Z | **2026-07-29 05:59:59Z** | s256 |
| `ce17b491-…` | apple | 2026-07-28 03:48:15Z | null | s256 |
| `eb455cb3-…` | google | 2026-07-28 03:48:05Z | null | s256 |

`auth_code_issued_at` being set means Supabase successfully exchanged
Apple's authorization code against Apple's token endpoint **using the
client secret JWT**, verified the identity token, and issued its own
auth code to hand back to the app. Twice, 30 seconds apart.

The user that produced:

```
id                 bbf89ec0-84db-40fd-8be6-f3d97590f6cd
created_at         2026-07-29 05:59:27Z
provider           apple
email_confirmed_at 2026-07-29 05:59:27Z
identities         1  (apple)
sessions           0     <-- the bug
last_sign_in_at    null  <-- the bug
```

An Apple account was created for the reviewer and then **zero sessions
were ever issued against it**. Both `flow_state` rows still exist;
GoTrue deletes a flow state when its code is redeemed, so neither code
was ever redeemed.

At 06:01:28Z, ninety seconds after the second failed Apple attempt, a
session was created for a *different* user — the reviewer falling back
to another sign-in path to get into the app. They then filed the bug.

`auth.identities` by provider (whole project, all time):

| provider | identities | last successful sign-in |
|---|---|---|
| google | 28 | 2026-07-31 01:49Z |
| email | 25 | 2026-07-13 20:52Z |
| azure | 11 | 2026-07-15 18:34Z |
| apple | 9 | 2026-07-29 05:59Z |

Apple sign-in has worked from inside the iOS shell before. Two sessions
carry the app's own WebView user-agent (`… Mobile/15E148 AdvotticApp/ios`)
against Apple-provider users, on 2026-07-03 and **2026-07-21**. So this
is a regression against a path that worked eight days before review, not
a feature that never worked.

---

## 3. Candidate causes, ruled in and out

### 3.1 Expired Apple client secret JWT — RULED OUT

This was the prime suspect and it is wrong.

`scripts/generate-apple-client-secret.mjs` mints an ES256 JWT with
`iss` = Team ID `FNU92FR9C9`, `kid` = Key ID `ULT8PCLT74`,
`sub` = Services ID `com.advottic.signin`, `aud` = `https://appleid.apple.com`,
`exp` = now + 180 days. The resulting JWT is pasted by hand into the
Supabase dashboard (Authentication → Providers → Apple → Secret Key).
It is not in any `.env`, not in Vercel, and not in the repo, so its `exp`
claim cannot be decoded from this machine. The signing key
`AuthKey_ULT8PCLT74.p8` is not on this machine either (the `.p8` files
under `~/.appstoreconnect/private_keys/` and `~/.eas-credentials/` are
`92XJKNP6PP` and `JYMPM87SA8`, both App Store Connect API keys, neither
the Sign in with Apple key).

It does not matter, because expiry is disproved directly: an expired
client secret makes Apple's token endpoint return `invalid_client`, and
Supabase would never reach `auth_code_issued_at`. It reached it twice on
2026-07-29 and created a confirmed user from the returned identity
token. The secret was valid at the moment of review.

Timeline corroborates: the generator was committed 2026-05-13
(`6ba71e8`), and 180 days from then is **2026-11-09**. Still ~3 months
of headroom.

Note for later: nothing watches that date. See remediation item R4.

### 3.2 Redirect URI / Service ID mismatch — RULED OUT

The project uses a **custom Supabase auth domain**, `auth.advottic.com`.
Probing the live authorize endpoint:

```
GET https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/authorize?provider=apple&redirect_to=…
302 location: https://appleid.apple.com/auth/authorize
  ?client_id=com.advottic.signin
  &redirect_uri=https%3A%2F%2Fauth.advottic.com%2Fauth%2Fv1%2Fcallback
  &response_mode=form_post&response_type=code&scope=email+name&state=…
```

So Supabase sends Apple `https://auth.advottic.com/auth/v1/callback`,
not the `*.supabase.co` URL. Following that link to Apple returns the
real sign-in page. The control test is what makes this conclusive —
Apple embeds a JSON error in the page when a Return URL is not
registered:

| redirect_uri sent to Apple | Apple's response |
|---|---|
| `https://auth.advottic.com/auth/v1/callback` | **clean sign-in page, no error** |
| `https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/callback` | `"errorMessage":"Invalid web redirect url.","errorCode":"invalid_request"` |
| `https://not-registered.advottic.com/cb` (control) | `"errorMessage":"Invalid web redirect url.","errorCode":"invalid_request"` |

The Service ID `com.advottic.signin` has `auth.advottic.com` registered
and verified, and that is exactly what Supabase sends. Correctly
configured. Worth knowing: the *old* `*.supabase.co` return URL is **not**
registered, so if the custom auth domain is ever removed, Apple sign-in
breaks instantly.

### 3.3 Supabase redirect allowlist rejecting the custom scheme — RULED OUT

Probed with `/auth/v1/verify`, whose 302 reveals whether `redirect_to`
was honoured or silently replaced by the Site URL:

| redirect_to | Location returned |
|---|---|
| `https://advottic.com/auth/callback` | honoured |
| `com.advottic.app://auth/callback` | **honoured** |
| `https://advottic.com/auth/callback?native=1&next=%2Fcases` | **honoured** |
| `https://evil.example.com/x` (control) | replaced with `https://advottic.com` |

The custom scheme is allowlisted. Supabase really did 302 the reviewer's
browser to `com.advottic.app://auth/callback?code=…`.

### 3.4 AAL2 / MFA step-up added at sign-in — RULED OUT

`a0ba5e9` added the check to `lib/supabase/middleware.ts`, gated behind
the server-only `MFA_AAL2_ENFORCEMENT` flag, unset by default. Even if it
were on in Vercel it could not produce this: it runs only on protected
routes for an *already-signed-in* user, and a brand-new Apple account has
no enrolled factor, so `currentLevel === nextLevel` and the branch never
fires. The reviewer never got a session at all, so middleware was never
reached with one. Independently, the one session created that morning
(06:01:28Z) is recorded at `aal1` and was not bounced.

### 3.5 Apple blocking its auth page in an embedded WebView — RULED OUT

Apple's page loaded and the reviewer authenticated successfully; Supabase
holds the resulting identity. Whatever browser surface it was shown in,
it worked.

### 3.6 Provider disabled / button not rendered — RULED OUT

`NEXT_PUBLIC_APPLE_ENABLED=1` is live: production `/sign-in` server-renders
the copy "Continue with Google, Microsoft, or Apple". Supabase's Apple
provider is enabled (it redirects to Apple rather than erroring).

### 3.7 Recent code change — RULED OUT as the trigger

Nothing in `app/sign-in`, `app/auth`, `middleware.ts`, `lib/supabase`,
`public/sw.js`, `next.config.mjs` or `vercel.json` changed between
2026-07-21 (last known good in-app Apple sign-in) and 2026-07-29. The
only change touching an auth-adjacent file was `87b511f`, a one-line edit
to `app/layout.tsx`.

What *did* change in that window is native: `8f58a32` (2026-07-25)
rewired the Xcode project, and a new binary went to review after it.

### 3.8 The return hop from the Safari sheet into the app — THE CAUSE

Everything above leaves exactly one step unaccounted for, and it is the
step the data shows failing:

```
app WebView  ── Browser.open (SFSafariViewController) ──▶ Supabase /authorize
                                                       ──▶ appleid.apple.com
   user authenticates
                     Apple auto-submits a form POST (response_mode=form_post)
                                                       ──▶ auth.advottic.com/auth/v1/callback
   Supabase exchanges with Apple, mints its own code   ✓ auth_code_issued_at
                     302 ──▶ com.advottic.app://auth/callback?code=…
                                                       ✗ never arrives in the app
   appUrlOpen never fires → exchangeCodeForSession never runs → 0 sessions
```

Why Apple specifically, when Google and Microsoft use the same custom
scheme: **Apple is the only provider whose result comes back as a
cross-site form POST.** `app/sign-in/sign-in-buttons.tsx` requests
`scopes: 'name email'` for Apple, and Apple forces
`response_mode=form_post` whenever a scope is requested (visible in the
authorize URL above). The final 302 is therefore issued in reply to a
POST navigation, and that is the navigation that has to leave the
`SFSafariViewController` and re-enter the app via a non-http scheme.
Google and Microsoft finish over an ordinary GET redirect chain.

Supporting detail rather than proof: the app opens the OAuth page with
`@capacitor/browser`, which is `SFSafariViewController`, **not**
`ASWebAuthenticationSession`. `ASWebAuthenticationSession` exists
precisely to intercept a custom callback scheme at the OS level before
the browser attempts to navigate to it; `SFSafariViewController` has no
such registration and is dependent on iOS choosing to follow an app-scheme
redirect. iOS 26 is the reviewer's platform and is the strictest to date
about app-scheme navigation without a user gesture.

Native pieces that were checked and are *not* at fault:

- `.github/workflows/ios-release.yml` does register the scheme
  (`CFBundleURLTypes` → `com.advottic.app`) on every build, after the
  `rm -rf ios && cap add ios` regeneration, so build 22 has it.
- `ios/App/App/AppDelegate.swift` keeps Capacitor's stock
  `application(_:open:options:)` and `continue userActivity` bridges.
- `@capacitor/app` and `@capacitor/browser` are both in `package.json`
  and both land in the generated SPM manifest, so the native branch of
  the sign-in code really is the branch that runs.

**Confidence.** That the code is issued and never redeemed: certain, from
the database. That the specific mechanism is the POST-originated
custom-scheme redirect out of `SFSafariViewController`: high but not
proven, because it cannot be observed without a device. Any alternative
explanation has to account for the same observable — the app never
receives the callback — and the remediation below is written to survive
being wrong about the mechanism.

### 3.9 Error surfacing — CONTRIBUTING, NOT CAUSAL

Worth fixing regardless, because it is what the reviewer actually saw.
When the callback never arrives, the old code left `LoadingOverlay`
("Bringing you in") covering the whole screen forever. No timeout, no
error, no way back except force-quitting the app. Dismissing the Safari
sheet did not clear it either. A permanently spinning sign-in screen is
indistinguishable from a crash to someone testing the app.

Separately, the native Apple path via `@capgo/capacitor-social-login`
is present but disabled (`NATIVE_APPLE_ENABLED = false`) with a comment
recording that it hung with no resolve and no reject, which produced the
same infinite spinner. Leave it off; see R3.

---

## 4. What shipped in this pass

Both changes are web-side. The iOS shell is a remote-URL Capacitor
wrapper, so they reach every installed build the moment Vercel deploys,
with no new binary and no App Store round-trip.

**`app/auth/callback/route.ts` — native return bridge.**
`/auth/callback?native=1` no longer attempts a server-side exchange. It
returns a small branded https page that navigates to
`com.advottic.app://auth/callback?code=…&next=…`, with a real
"Return to Advottic" button behind the automatic attempt. The page
deliberately runs no exchange of its own: the PKCE verifier cookie lives
in the app WebView's cookie jar, not the Safari sheet's, so the exchange
can only succeed back inside the app — which `app/sign-in` already does
in its `appUrlOpen` handler. Carries `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`, since the
markup contains a single-use auth code.

**`app/sign-in/sign-in-buttons.tsx` — Apple routed through the bridge.**
Apple's native `redirectTo` becomes
`https://advottic.com/auth/callback?native=1&next=…` instead of the raw
custom scheme. Google and Microsoft are untouched and keep the direct
scheme: they return over a plain GET, that path is what installed builds
use today, and there is no evidence it is broken. Because Apple is
currently broken for everyone, an Apple-only change cannot regress
anything that works.

Verified: `https://advottic.com/auth/callback?native=1&next=%2Fcases` is
already accepted by Supabase's redirect allowlist (section 3.3), so this
needs no dashboard change.

**Same file — dismissal watchdog.** A `Browser.addListener('browserFinished')`
handler clears the full-screen veil and shows recoverable copy if the
OAuth sheet closes without a callback ever arriving, instead of spinning
forever. Guarded so that closing the sheet ourselves after a successful
handoff does not trip it.

Verification run: `npx tsc --noEmit` clean; `npx vitest run` 137 passed,
4 failed — the same 4 failures are present on unmodified `main`
(`git stash` comparison), so they pre-date this work and are unrelated
(timeline exhibit PDF page counts).

The changes are left **uncommitted** in the working tree. That tree also
contains unrelated in-progress edits from another session (several
`app/counsel/**` files), so committing was left to a human who can
separate them.

---

## 5. Remediation — what a human has to do

### R1. Deploy and verify on a real device (required before resubmitting)

The fix is unverifiable from a workstation. It must be exercised on a
physical iPhone before the binary goes back to Apple.

1. Commit `app/auth/callback/route.ts` and `app/sign-in/sign-in-buttons.tsx`
   (only those two from the current working tree) and let Vercel deploy.
2. On a physical iPhone running the TestFlight build, force-quit Advottic
   and relaunch it, so the cache-first service worker picks up the new
   deploy. If the "Advottic just updated — Reload" banner appears, take it.
3. Sign out. Tap **Sign in with Apple**. Complete Apple's sheet.
4. Expected: a brief dark "Signing you in" screen, then the app returns
   and lands on `/cases` signed in.
5. If it stalls on that screen, tap **Return to Advottic**. If the button
   works and the automatic hop does not, that is still a pass for review
   purposes and confirms the mechanism in 3.8.
6. Confirm in SQL:
   ```sql
   select u.email, u.last_sign_in_at,
          (select count(*) from auth.sessions s where s.user_id = u.id) as sessions
   from auth.users u
   where u.raw_app_meta_data->>'provider' = 'apple'
   order by u.created_at desc limit 3;
   ```
   `sessions` must be non-zero. That is the exact number that was 0 for
   the reviewer.

Use a physical, unlocked device. iPhone Mirroring keeps the phone locked
and system sheets will not present properly.

### R2. If R1 still fails — switch Apple to the native sheet

If the bridge does not get the app reopened, the remaining correct fix is
to stop using a browser for Apple at all: `ASAuthorizationController`
via `@capgo/capacitor-social-login`, which is already installed and
already wired in `sign-in-buttons.tsx` behind `NATIVE_APPLE_ENABLED`.
This needs a new binary, and before flipping that flag the previously
reported hang must be reproduced and fixed — a hang neither resolves nor
rejects, so the existing catch-based fallback never fires and the button
spins forever, which is a worse review outcome than today. Requires, in
the Supabase dashboard: Authentication → Providers → Apple →
**Authorized Client IDs** must list `com.advottic.app` (the bundle ID),
or `signInWithIdToken` rejects with an audience error.

### R3. Do not chase the client secret

It is valid until roughly 2026-11-09 and is not the cause. Rotating it
now would change a working input while the real fault is elsewhere.

### R4. Calendar the client secret expiry (owner action)

Nothing in the codebase or CI watches it, and when it does lapse the
symptom is Apple sign-in failing for everyone while Google, Microsoft and
email keep working — the failure this investigation initially expected.
Set a reminder for **2026-10-25**, ahead of the ~2026-11-09 expiry:

```
node scripts/generate-apple-client-secret.mjs /path/to/AuthKey_ULT8PCLT74.p8
```

then paste the JWT into Supabase → Authentication → Providers → Apple →
Secret Key. The `.p8` for key `ULT8PCLT74` is **not on this machine** and
Apple does not allow re-downloading it. If it has been lost, a new key
must be created at developer.apple.com → Certificates, Identifiers &
Profiles → Keys, with Sign in with Apple enabled, and `KEY_ID` in the
script updated to match.

### R5. Protect the custom auth domain (owner action)

Apple's Service ID `com.advottic.signin` has **only**
`https://auth.advottic.com/auth/v1/callback` registered as a Return URL.
The `*.supabase.co` equivalent is not registered and is actively rejected
by Apple (3.2). Removing or letting the Supabase custom domain lapse
breaks Apple sign-in immediately. Either treat that domain as load-bearing,
or add the `*.supabase.co` callback as a second Return URL in the Apple
Developer portal so there is a fallback.

### R6. Unrelated, but found while reading the release workflow

`ios/App/add_widget_target.rb` is never invoked by
`.github/workflows/ios-release.yml`. The workflow does
`rm -rf ios && npx cap add ios && npx cap sync ios`, which discards the
committed `App.xcodeproj` that `8f58a32` edited to add the WidgetKit
target. If the shipped binary is expected to contain
`App.app/PlugIns/AdvotticWidget.appex`, verify that it actually does —
the 4.2 defence depends on it. Not related to sign-in.

---

## 6. Reproduction commands

Read-only. Safe to re-run.

```bash
# What Supabase sends Apple (note the custom auth domain)
curl -sSD - -o /dev/null \
  "https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/authorize?provider=apple&redirect_to=https%3A%2F%2Fadvottic.com%2Fauth%2Fcallback" \
  | grep -i '^location'

# Whether Apple accepts a given Return URL (grep the embedded JSON error)
curl -sS "https://appleid.apple.com/auth/authorize?client_id=com.advottic.signin&redirect_uri=<urlencoded>&response_mode=form_post&response_type=code&scope=email+name&state=t" \
  | grep -o '"errorMessage":"[^"]*"'

# Whether Supabase's allowlist honours a redirect_to (Location reveals it)
curl -sSD - -o /dev/null \
  "https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/verify?token=bogus000000&type=magiclink&redirect_to=<urlencoded>" \
  | grep -i '^location'
```

```sql
-- Apple flows that produced a code but no session
select f.id, f.created_at, f.auth_code_issued_at, f.user_id
from auth.flow_state f
where f.provider_type = 'apple'
order by f.created_at desc limit 20;

-- Sessions originating inside the native shell
select s.created_at, s.user_agent, u.raw_app_meta_data->>'provider' as provider
from auth.sessions s join auth.users u on u.id = s.user_id
where s.user_agent ilike '%AdvotticApp%'
order by s.created_at desc;
```

---

Last updated 2026-07-31.
