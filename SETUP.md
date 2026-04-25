# CounselOptics — Supabase + OAuth Setup

This guide walks you through enabling account sign-in (Google + Microsoft) and moving case
files + exhibits + AI reviews into a real database. Expect **15–45 minutes** total, depending
on whether you've set up Google / Microsoft OAuth apps before.

When this guide is complete, the app will:

- Require users to sign in at `/sign-in` before accessing `/cases/*`
- Store cases, exhibits, and reviews in Supabase Postgres with row-level security
- Upload evidence files to a private Supabase Storage bucket
- Serve exhibits via short-lived signed URLs

Until you finish setup, the app keeps working in **local mode** (single-user, JSON file
storage). You can migrate data over afterwards if you want.

---

## Step 1 — Create a Supabase project

1. Go to https://supabase.com and sign up (GitHub auth is fine).
2. Create a new project. Pick any name, region, and generate a strong database password.
3. Wait ~1 min for the project to provision.

## Step 2 — Apply the schema

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. The script creates three tables (`cases`, `exhibits`, `ai_reviews`), row-level-security
   policies, a storage bucket called `exhibits`, and storage policies that keep each user's
   files scoped under their own `user_id`.

## Step 3 — Copy your project URL + anon key into `.env.local`

1. In the Supabase dashboard, open **Project Settings → API**.
2. Copy the following and paste into `.env.local` at the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...the anon / public key...
```

Keep `ANTHROPIC_API_KEY=...` in the same file so Claude reviews still work.

Restart the dev server after editing `.env.local`.

## Step 4 — Enable Google sign-in

1. In Supabase: **Authentication → Providers → Google → Enabled = ON**. Leave Client ID /
   Secret blank for now and note the **Authorized redirect URL** shown
   (looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`).
2. Go to https://console.cloud.google.com/ → create (or reuse) a project →
   **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URI: the URL from Supabase (step 1 above)
3. Copy the **Client ID** and **Client secret** from Google and paste them back into
   Supabase's Google provider form. Save.
4. **OAuth consent screen** — for a personal test, set **User Type = External** and add your
   own email as a test user. Production rollout requires additional verification from Google.

## Step 5 — Enable Microsoft sign-in

Supabase calls Microsoft OAuth the "Azure" provider.

1. In Supabase: **Authentication → Providers → Azure → Enabled = ON**, leave credentials blank
   and note the **Authorized redirect URL**.
2. Go to https://entra.microsoft.com (Microsoft Entra / Azure AD) →
   **App registrations → New registration**:
   - Name: `CounselOptics` (or anything)
   - Supported account types: **Personal Microsoft accounts + work/school** (the "multi-tenant
     + personal" option)
   - Redirect URI: **Web** → the Supabase callback URL from above
3. In the new app, copy the **Application (client) ID** → paste into Supabase as the Azure
   Client ID.
4. **Certificates & secrets → New client secret** → copy the secret **value** (not the ID) and
   paste into Supabase as the Azure Client Secret. Set a reasonable expiration.
5. **API permissions → Microsoft Graph → Delegated** → add `openid`, `email`, `profile`
   (usually already there). Save.
6. In Supabase, the Azure provider may ask for a **Tenant URL**. For multi-tenant/personal
   accounts, enter: `https://login.microsoftonline.com/common`.

## Step 6 — Test the flow

1. Restart the dev server: `npm run dev`.
2. Visit http://localhost:3000/sign-in
3. Click **Continue with Google** (or **Continue with Microsoft**). You should bounce to the
   provider, approve, bounce back through `/auth/callback`, and land on `/cases`.
4. Create a new case, upload an exhibit, run a review. Everything should persist to Supabase.
   Confirm by opening **Table Editor → cases / exhibits / ai_reviews** in the dashboard.

## Step 7 — (Optional) Migrate your local data

If you had cases in `./data/db.json` from local mode and want to bring them over, you can
hand-recreate them, or run the ad-hoc Node script in `scripts/run-review.mjs` style. A one-shot
JSON → Supabase importer isn't included yet — ping me and I'll add it.

---

## Troubleshooting

**"redirect_uri_mismatch" on Google** — the redirect URI in your Google OAuth client must be
**exactly** the Supabase callback URL, including the trailing path and no trailing slash.

**Microsoft sign-in fails with "AADSTS50020"** — your Entra app registration is set to
single-tenant. Change it to multi-tenant (or add your account to the tenant).

**Files won't load after sign-in** — the `exhibits` storage bucket must exist and the storage
policies in the schema must be applied. Re-run `schema.sql`.

**Middleware keeps redirecting after login** — clear cookies for `localhost` and try again.
Session cookies can get stuck during development.
