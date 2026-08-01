# Advottic

Secure, subscription-based legal case-building platform. The current build covers the
**case-builder + AI review + PDF export** slices end-to-end on local storage.

## What's in this build

- Next.js 14 App Router + TypeScript + Tailwind
- Supabase Auth (Google + Microsoft OAuth), Supabase Postgres, Supabase Storage - enabled once
  you follow [SETUP.md](SETUP.md). Until then, the app runs in local JSON mode.
- Server actions for case creation, evidence upload, and AI review
- AI case review backed by Anthropic Claude (Sonnet 4.6) with prompt caching and tool-use
  structured output. Falls back to a clearly-labeled demo response when no API key is set.
- PDF case-file export (cover page, exhibit index, AI review, disclaimer) via `pdfkit`

## What's deferred

- Subscription and billing (Stripe)
- Admin dashboard, audit logs, malware scanning
- One-shot JSON → Supabase migration script

## Local development

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

In **local mode** (no Supabase env vars set), cases are stored at `./data/db.json` and uploaded
files at `./data/uploads/`. Both are gitignored. Delete `./data/` to reset.

### Enable accounts + real database

Follow [SETUP.md](SETUP.md). You'll create a free Supabase project, paste in a schema, and
enable Google + Microsoft OAuth. Takes 15–45 minutes. Afterwards, `/cases/*` requires sign-in
and all data lives in Supabase with row-level security.

### Enable real AI review

Copy `.env.local.example` to `.env.local` and set `ANTHROPIC_API_KEY`. Without it, the review
panel returns a clearly-marked demo response so the app keeps working offline.

**Gotcha:** some shells (notably the Claude Code wrapper) pre-set `ANTHROPIC_API_KEY=` to an
empty string. Next.js's dotenv loader will not overwrite an env var that's already set, even if
it's empty - so `.env.local` gets silently ignored and you stay in demo mode. This app works
around it by reading `.env.local` directly when `process.env.ANTHROPIC_API_KEY` is empty, but if
you hit the issue elsewhere, unset the variable before starting:

```bash
unset ANTHROPIC_API_KEY && npm run dev
```

### Force a real review from the CLI

`scripts/run-review.mjs` calls Claude directly against your existing case data and writes the
result into `./data/db.json`. Useful for smoke tests or bulk-regenerating reviews:

```bash
node scripts/run-review.mjs                 # all cases
node scripts/run-review.mjs <caseId>        # one case
```

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run start`: serve the production build

## Disclaimer

Advottic provides legal information and case organization tools. It does not provide legal
advice, does not represent users, and does not create an attorney-client relationship.
