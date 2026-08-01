-- Record the Stripe payment_link ID on a firm invoice, so the link can be
-- switched off and a payment made through it can be traced back.
--
-- ============================== APPLIED ==================================
-- Written and APPLIED 2026-08-01 to the Advottic project
-- (hpmtlhpyvbreyfimftgt), recorded as migration
-- firm_invoice_payment_link_id. supabase/schema-fingerprint.sha256 was
-- regenerated in the same commit.
--
-- Note for anyone reading the fingerprint history: the baseline was
-- ALREADY stale before this migration (live 4fc660e4..., committed
-- 8a719170...). Several earlier migrations were live without a regen -
-- the case-membership policy on ai_reviews, firm_guest_accounts,
-- case_activity, firm_intake_messages. The new hash therefore blesses
-- those too, not only this column.
-- =========================================================================
--
-- The problem it fixes:
--
-- sendInvoiceAction mints a Stripe payment link per send and stores only
-- its URL, in firm_invoices.stripe_payment_link. A Stripe payment link is
-- REUSABLE and stays payable until it is explicitly deactivated, and
-- deactivating one is a POST to /v1/payment_links/{id} - which needs the
-- plink_ ID. The buy.stripe.com/... URL does not contain that ID and it
-- cannot be derived from it. So until this column exists there is no way,
-- from the invoice row, to stop a link being paid.
--
-- That left three live ways for a client to pay money the firm is not
-- owed, all of them through a link the app itself sent them:
--
--   1. The invoice is voided. Status flips, the client's Pay button keeps
--      working.
--   2. A send fails delivery and rolls back to draft. The firm sends
--      again, minting a SECOND link, and both are payable.
--   3. The invoice is marked paid by hand after a wire arrives. The link
--      is still a working Pay button, and it is reusable.
--
-- It also left Stripe payments unreconcilable: an incoming payment could
-- not be matched to an invoice, so nothing marked one paid automatically.
-- The webhook now resolves the invoice from the session metadata first and
-- from this column as the fallback.
--
-- Nullable with no default and no backfill, deliberately:
--   * Draft invoices have no link. Never have.
--   * Invoices sent BEFORE this migration have a URL and no ID, and there
--     is no way to recover the ID from the URL. Those links can only be
--     deactivated from the Stripe dashboard. deactivatePaymentLink treats
--     a null ID as "nothing payable to switch off" and returns success, so
--     voiding one of those invoices still works - it just cannot revoke
--     the link. See the operational note at the bottom of this file.
--
-- No RLS change. The column sits on firm_invoices, which is already
-- covered by firm_invoices_member_select and firm_invoices_member_write
-- (supabase/fixes/2026-07-03-billing-schema.sql); a new column inherits
-- both. The webhook writes through the service-role client because it has
-- no user session, which is a bypass of RLS by design and not a change to
-- it.

alter table public.firm_invoices
  add column if not exists stripe_payment_link_id text;

comment on column public.firm_invoices.stripe_payment_link_id is
  'Stripe payment_link ID (plink_...) for the link in stripe_payment_link. Needed to deactivate the link, which stays payable until Stripe is told otherwise, and to match an incoming payment back to this invoice. Null for drafts and for invoices sent before 2026-08-01.';

-- The webhook resolves an invoice from this column when the checkout
-- session carries no copied metadata. That is a point lookup on every
-- payment link event, so it should not be a sequential scan over the
-- firm's whole invoice history. Partial: only sent invoices carry a live
-- link, and the vast majority of rows are null here.
create index if not exists firm_invoices_payment_link_id_idx
  on public.firm_invoices (stripe_payment_link_id)
  where stripe_payment_link_id is not null;

-- ---------------------------------------------------------------------
-- Operational note for whoever applies this
-- ---------------------------------------------------------------------
-- RESOLVED at apply time: firm_invoices had ZERO rows, so there were no
-- pre-existing invoices carrying an unrevocable link and nothing needed
-- cleaning up in the Stripe dashboard. The query below is kept because it
-- is the right check to re-run if this migration is ever applied to
-- another environment that does have invoice history.
--
-- Any invoice that is void or paid AND still has a stripe_payment_link set
-- has a live, payable link that this migration cannot revoke, because its
-- ID was never recorded. Those have to be deactivated by hand in the
-- Stripe dashboard (Payments > Payment links). To list them:
--
--   select id, number, status, stripe_payment_link
--     from public.firm_invoices
--    where stripe_payment_link is not null
--      and stripe_payment_link_id is null
--      and status in ('void', 'paid');
--
-- Every link minted after this ships records its ID and is revoked
-- automatically.
