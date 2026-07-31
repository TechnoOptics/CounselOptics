# Auth provider setup: checklist for fixing OAuth sign-in failures

This document is the operator-side checklist for the two errors that
surfaced 2026-05-12:

```
Unable to exchange external code: 1.AX
PKCE code verifier not found in storage. ...
```

The code-side fixes have shipped (force apex-only sign-in, clear stale
PKCE cookies, better error copy). The remaining work is configuration
in three places: Supabase, the Microsoft Azure app, and the Google
Cloud OAuth client. None of these can be fixed from the codebase.

---

## 1. Supabase Auth settings

Open the Supabase dashboard for the Advottic project (project ref
`hpmtlhpyvbreyfimftgt`). Go to **Authentication → URL Configuration**.

### Site URL

Set to the apex, EXACTLY:

```
https://advottic.com
```

No trailing slash. No `www.`. Anything else and Supabase falls back to
this value when an OAuth redirect URL is not on the allowlist, and the
user lands at `https://advottic.com/?code=...` (no `/auth/callback`)
where nothing handles the exchange.

### Additional Redirect URLs

Add ALL of these, one per line:

```
https://advottic.com/auth/callback
https://advottic.com/auth/callback?**
https://*.advottic.com/auth/callback
https://*.advottic.com/auth/callback?**
http://localhost:3000/auth/callback
http://localhost:3000/auth/callback?**
```

The `?**` variants allow our `?next=...` query string. Without them,
Supabase strips the next param and the user lands at /cases instead of
the path they were trying to reach when they hit the sign-in gate.

The `*.advottic.com` entry covers tenant subdomains
(`<slug>.advottic.com`), `hq.advottic.com`, and
`enterprise.advottic.com` for the white-label and admin shells.

Save. Changes are live within seconds.

---

## 2. Microsoft Azure (Microsoft sign-in)

The "Unable to exchange external code: 1.AX" error means Supabase
received the auth code from Microsoft and then Microsoft rejected the
token-exchange call. Three places to check.

### 2a. App registration redirect URIs

Open the Azure portal → **Microsoft Entra ID** → **App registrations**
→ select the Advottic OAuth app (the one whose Client ID matches
`MICROSOFT_CLIENT_ID` in Vercel). Then **Manage → Authentication**.

Under **Web → Redirect URIs**, ensure this entry exists EXACTLY:

```
https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/callback
```

If there is a stale entry like `https://www.advottic.com/auth/callback`
or `https://advottic.com/auth/callback`, REMOVE it. Microsoft only
redirects to URIs you have registered, and the one Supabase expects is
the Supabase project URL, not our app domain. (Supabase is the
intermediary that exchanges the Microsoft code, then issues its own
code that comes back to our app.)

Click **Save**.

### 2b. Supported account types

Same Azure app → **Authentication** page → near the top, **Supported
account types**. Set to:

```
Accounts in any organizational directory (Any Microsoft Entra ID
tenant - Multitenant) and personal Microsoft accounts (e.g. Skype,
Xbox)
```

If this is set to "Single tenant" or "Multitenant only", any user
outside that scope gets rejected at the token-exchange step, which
surfaces as `Unable to exchange external code` rather than a clean
provider error.

### 2c. Client secret (and its expiry)

Same Azure app → **Manage → Certificates & secrets**. Look at the
**Client secrets** table.

- If the secret's **Expires** column shows a date in the past, the
  secret has expired. Generate a new one (button: **+ New client
  secret**), copy the **Value** (you only see it once), and paste it
  into the Supabase **Authentication → Providers → Azure** form as
  the **Client Secret**. Save in Supabase.
- Also update `MICROSOFT_CLIENT_SECRET` in Vercel if the value is
  referenced server-side (it is referenced in our app for one-off
  enterprise SSO flows; the Supabase-OAuth flow uses the Supabase-side
  setting).

### 2d. Supabase Azure provider config

Supabase dashboard → **Authentication → Providers → Azure**. Verify:

- **Enabled**: ON.
- **Client ID**: matches `MICROSOFT_CLIENT_ID` env var.
- **Secret**: the freshly-generated secret from 2c.
- **Tenant URL** (sometimes labeled "Azure Tenant URL"): leave blank
  for multitenant; set to `https://login.microsoftonline.com/<tenant>`
  for single-tenant.

Save.

### 2e. Test

In a private/incognito window: open https://advottic.com/sign-in,
click "Continue with Microsoft", complete the Microsoft sign-in. You
should land at /cases with an active session. If you see "Unable to
exchange external code" again, log the timestamp and check Supabase
dashboard → **Logs → Auth** for the corresponding row; the error there
includes the underlying provider response which pinpoints which of
2a-2d is still off.

---

## 3. Google Cloud (Google sign-in)

The "PKCE code verifier not found" error is now mitigated client-side
(we force apex-only sign-in and clear stale verifier cookies), but the
Google OAuth client config should still be verified.

### 3a. OAuth consent screen

Google Cloud Console → **APIs & Services → OAuth consent screen**.

- **User type**: External.
- **Authorized domains**: must include `advottic.com`. If
  `supabase.co` is missing, add it (the redirect URI host).
- **Publishing status**: In production (or in Testing with the
  expected test users listed).

### 3b. OAuth 2.0 client credentials

**APIs & Services → Credentials → OAuth 2.0 Client IDs** → select the
Advottic web client (the one whose Client ID matches the Supabase
Google provider config).

Under **Authorized redirect URIs**, ensure:

```
https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/callback
```

is the ONLY entry, or at minimum is one of the entries. If you see
stale entries like `https://www.advottic.com/auth/callback` or
`https://advottic.com/auth/callback`, remove them.

Save.

### 3c. Supabase Google provider config

Supabase dashboard → **Authentication → Providers → Google**.

- **Enabled**: ON.
- **Client ID**: matches Google Cloud's client ID.
- **Client Secret**: matches Google Cloud's client secret.
- **Authorized Client IDs**: leave blank unless you want native iOS
  / Android client IDs to share the web flow.

Save.

---

## 4. Smoke test after configuration

In a private/incognito window with no cached state, in this exact
order:

1. https://advottic.com → marketing renders.
2. https://advottic.com/sign-in → sign-in form renders, three
   provider buttons visible (Google / Microsoft / Apple if enabled).
3. Click **Continue with Google** → Google sign-in screen →
   complete → redirect back → land at /cases with a session.
4. Click avatar (top right) → **Sign out** → back to /sign-in.
5. Click **Continue with Microsoft** → Microsoft sign-in screen →
   complete → redirect back → land at /cases with a session.
6. https://www.advottic.com/sign-in (note `www.`) → the edge redirect
   should bounce to https://advottic.com/sign-in BEFORE the sign-in
   form renders. Provider buttons should still work from there.
7. Open https://www.advottic.com/sign-in **without** redirecting (in
   the rare case the 307 doesn't fire) → click a provider → the
   client-side guard we shipped (`forceApexBeforeAuth`) bounces to
   apex first → flow completes normally.

If any of 1-7 fail, the error message is now actionable:

- "Sign-in started on one window and finished on another" → user-side
  fix (open https://advottic.com/sign-in fresh).
- "The sign-in provider rejected the response" → operator-side
  config issue. Go back to section 2 (Microsoft) or 3 (Google) of
  this doc.

---

## 5. What's currently shipped on the code side

Commit reference: see git log around 2026-05-12 for the SSO fixes.

- `app/sign-in/sign-in-buttons.tsx` now calls `forceApexBeforeAuth()`
  and `clearStalePkceCookies()` before every provider sign-in and
  magic-link send.
- `app/auth/callback/route.ts` translates the two most common
  Supabase exchange failures into actionable user copy.
- `lib/supabase/client.ts` continues to scope auth cookies to
  `.advottic.com` so the session travels across apex + every
  subdomain.

If the errors persist after walking through sections 1-3, capture the
Supabase Auth log row (it has the actual provider response) and email
support@advottic.com.

---

## Last updated

2026-05-12.
