-- Signing lifecycle: let a signer reject or request changes, and give
-- the request statuses to reflect that. Recall reuses the existing
-- 'canceled' status (already blocks the sign page + POST route).

alter table firm_signing_requests
  drop constraint if exists firm_signing_requests_status_check;
alter table firm_signing_requests
  add constraint firm_signing_requests_status_check
  check (status = any (array[
    'draft','sent','partial','completed','canceled','rejected','changes_requested'
  ]));

alter table firm_signatures
  add column if not exists response text
    check (response is null or response = any (array['rejected','changes_requested']));
alter table firm_signatures
  add column if not exists response_note text;
alter table firm_signatures
  add column if not exists responded_at timestamptz;
