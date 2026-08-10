-- Per-request control over whether the SIGNER may download a copy of
-- what they signed.
--
-- ============================== APPLIED ==================================
-- Not applied by the change that introduced it, but APPLIED to production
-- afterwards. This header said only "NOT APPLIED BY THE CHANGE THAT
-- INTRODUCED IT" until 2026-08-10, which a reader could take for pending.
--
-- WHAT SETTLED IT, from the repo alone: commit 352976e8, "Regenerate the
-- schema fingerprint after applying seven migrations", is an ancestor of
-- main. It states the seven then-pending migrations were applied in
-- filename order and lists the objects checked in the live database,
-- including "firm_signing_requests gains signer_can_download". This file
-- is the only place in supabase/migrations that adds that column. The same
-- commit regenerated supabase/schema-fingerprint.sha256, so nothing is owed.
--
-- Nothing in CI could have contradicted a stale banner: the schema-drift
-- gate self-skips while the SUPABASE_DB_URL secret is unset, so it has never
-- executed a comparison. See scripts/schema/README.md, "Current status".
-- =========================================================================
--
-- Why a column and not a jsonb key: firm_signing_requests has no jsonb
-- column to hang this off. Its columns are id, firm_id, document_id,
-- requested_by, status, message, sent_at, completed_at, created_at,
-- document_sha256 and signed_file_path, all scalar. Inventing a
-- settings jsonb for one boolean would cost more than the boolean.
--
-- Default true. A signer keeping a copy of what they signed is the
-- ordinary expectation, and E-SIGN at 15 USC 7001(a)(1) conditions the
-- validity of an electronic record on it being retainable by the
-- person bound to it. The firm can turn it off for a particular
-- request; silence means yes.
--
-- The application already treats a MISSING column as permitted (see
-- parseSignerDownloadPermission in lib/signer-view.ts), so the code
-- runs correctly both before and after this is applied. The one thing
-- that does not work before it is applied is a firm turning the
-- permission OFF: the insert falls back to a write without the column
-- and the composer says so rather than pretending the restriction
-- stuck.

alter table public.firm_signing_requests
  add column if not exists signer_can_download boolean not null default true;

comment on column public.firm_signing_requests.signer_can_download is
  'Whether the signer may download a copy of the document they signed from /sign/[token]. Enforced server-side by the signer copy route, not only in the UI. Defaults to true (E-SIGN 15 USC 7001(a)(1) retention).';

do $$
declare
  has_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'firm_signing_requests'
      and column_name = 'signer_can_download'
  ) into has_col;
  if not has_col then
    raise exception '[signer-download] firm_signing_requests.signer_can_download is missing.';
  end if;
  raise notice '[signer-download] firm_signing_requests.signer_can_download present.';
end $$;
