# Schema-drift gate

Catches the case where the live Supabase `public` schema drifts from what git
records: a dashboard edit, a manual `SQL editor` change, or an applied
migration that nobody committed a fingerprint update for.

## How it works

- **`fingerprint-hash.sql`**: returns a single `sha256` over a deterministic,
  per-object fingerprint of the `public` schema (tables + their column set,
  constraints, indexes, RLS policies, triggers, functions). Definitions are
  folded into `md5`s so the fingerprint is compact and immune to cosmetic
  formatting; object identities stay in plaintext. The hash is computed
  **entirely server-side**, so the value the baseline was generated with and
  the value CI reads match unless the schema truly changed, with no dependency
  on `psql`/locale formatting.
- **`fingerprint.sql`**: returns the same fingerprint as one line per object
  (not hashed). Used only for human inspection when the gate fails, so you can
  see which objects exist now. **Keep it in sync with `fingerprint-hash.sql`.**
- **`../../supabase/schema-fingerprint.sha256`**: the committed baseline hash.
- **`../../.github/workflows/schema-drift.yml`**: CI job that recomputes the
  live hash and fails on mismatch. It self-skips until the `SUPABASE_DB_URL`
  repo secret is set (a **read-only** connection string is enough, since the
  check only reads catalog metadata).

## Enabling the gate

Add a repo secret `SUPABASE_DB_URL` (Settings → Secrets and variables →
Actions). A read-only role is preferred:

```
postgresql://<read_only_user>:<password>@<host>:5432/postgres
```

Once set, the job runs on every push/PR and weekly (Mondays), catching
out-of-band dashboard edits between deploys.

## After an intentional schema change

When you apply a migration (or otherwise change the schema on purpose),
regenerate the baseline and commit it alongside the migration:

```sh
psql "$SUPABASE_DB_URL" -X -q -t -A -f scripts/schema/fingerprint-hash.sql \
  | tr -d '[:space:]' > supabase/schema-fingerprint.sha256
git add supabase/schema-fingerprint.sha256
```

If you don't have direct DB access, the CI failure log prints the full live
fingerprint (`fingerprint.sql`) so you can copy the new hash from a colleague
who does, or read what changed.
