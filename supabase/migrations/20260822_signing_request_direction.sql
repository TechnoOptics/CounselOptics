-- Which way a signature request runs, and whether the firm has authorised
-- putting its own name on somebody else's document.
--
-- =========================== APPLIED TO PRODUCTION 2026-08-22 ==========================
-- Applied on 2026-08-22, BEFORE this code was merged, which is the ordering
-- the 2026-08-07 deploy settled. It matters here specifically: the write of
-- paper_origin ABORTS rather than retrying without the column, so shipping
-- the code first would have failed every firm document filing until the
-- column existed.
--
-- Verified after applying by reading information_schema rather than by
-- trusting the apply call. supabase/schema-fingerprint.sha256 was
-- regenerated in the same commit, 19ea6b98 to f8b5a1b0, computed server
-- side by scripts/schema/fingerprint-hash.sql.
--
-- The CI drift gate self-skips until the SUPABASE_DB_URL repo secret exists,
-- so this banner is the only record of applied state, which is exactly why
-- it was corrected here rather than left to rot.
--
-- WHAT THIS IS FOR
--
-- Every signing request this product has ever created runs one way: the firm
-- sends its document out and an outside party signs it. The firm's decision
-- happens BEFORE the document leaves, on the approvals queue, and by the time
-- a signer link exists the decision is already made.
--
-- The second kind runs the other way. A counterparty sends the firm their
-- document and asks the firm to sign it. Nothing of the firm's is being
-- released, so the outbound approval gate never fires, and yet this is the
-- direction where the firm actually becomes bound. The signer link is minted
-- as usual, and until somebody on the legal team says so it must not open.
--
-- WHY direction IS NULLABLE AND NOT BACKFILLED
--
-- Null READS as 'outbound', in one function, readSigningDirection in
-- lib/signing-authorization.ts. That is what every row in the table is: the
-- inbound direction did not exist before this migration, so there is nothing
-- to backfill and no row whose meaning is in doubt. Writing a value onto
-- rows to say what their absence already says would be churn on a table the
-- audit chain hangs off.
--
-- WHY authorization_status IS NOT NULL WITH A DEFAULT, WHEN direction IS NOT
--
-- Because the two absences mean opposite things.
--
-- An absent direction means "the ordinary one", and the ordinary one is
-- ungated, so reading it permissively is correct.
--
-- An absent authorisation would have to be read as "not required" for every
-- existing row, which is true of them and would be catastrophic if it were
-- ever true of an inbound row: the gate would simply not be there. A NOT NULL
-- default makes that unrepresentable in the database rather than depending on
-- a reader getting it right. An inbound request is inserted with 'pending'
-- explicitly, and lib/signing-authorization.ts refuses anything that is not
-- 'approved' on an inbound request, including 'not_required'.
--
-- ON THE COLUMN-MISSING FALLBACK, WHICH IS AN ABORT
--
-- Same test as resolveDeliveryModeColumnFallback in lib/submission-dispatch.ts.
-- An OUTBOUND request never names these columns at all, so between merge and
-- apply nothing about existing behaviour changes and there is nothing to
-- retry. An INBOUND request names both, and dropping them on a retry would
-- create a request that reads as outbound and therefore ungated, with a live
-- signer link, on a counterparty's document. That is the gate removing itself
-- to get a row written. It aborts. See resolveSigningDirectionColumnFallback
-- and INBOUND_AUTHORIZATION_UNSAVED_ERROR in lib/signing-authorization.ts.
--
-- WHO MAY AUTHORISE
--
-- Not recorded here, and deliberately not a second list. The gate reuses
-- canApproveSubmissions from lib/template-approval.ts, which reads
-- FIRM_MANAGE_ROLES: owner, admin, attorney. The people who may let the
-- firm's document out are the people who may let the firm's name onto
-- somebody else's, and a second list of roles for the second direction is how
-- the two would drift apart.

alter table public.firm_signing_requests
  add column if not exists direction text
    check (direction in ('outbound', 'inbound'));

alter table public.firm_signing_requests
  add column if not exists authorization_status text not null
    default 'not_required'
    check (authorization_status in ('not_required', 'pending', 'approved', 'declined'));

alter table public.firm_signing_requests
  add column if not exists authorized_by uuid references auth.users(id);

alter table public.firm_signing_requests
  add column if not exists authorized_at timestamptz;

-- The legal team's own working note on the decision. It is NOT the
-- employee's to read: app/portal/[id]/page.tsx fetches through the
-- service-role client behind a hand-written gate, so the column list on that
-- query is the whole of the boundary, and tests/employee-payload-scope.test.ts
-- holds it there.
alter table public.firm_signing_requests
  add column if not exists authorization_note text;

-- The queue reads one firm's requests, narrowed by direction and status, and
-- that is the only shape it reads them in.
create index if not exists firm_signing_requests_direction_idx
  on public.firm_signing_requests (firm_id, direction, status);

comment on column public.firm_signing_requests.direction is
  'outbound: our document, signed by an outside party. inbound: their '
  'document, signed by us. Null reads as outbound, which is every row that '
  'existed before this migration. See lib/signing-authorization.ts.';

comment on column public.firm_signing_requests.authorization_status is
  'Whether the legal team has authorised signing an inbound document. '
  'not_required on every outbound request. app/sign/[token] refuses to open '
  'an inbound request that is not approved.';
