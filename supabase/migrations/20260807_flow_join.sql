-- The join between the employee approval flow and the counterparty
-- signing flow.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-07. The owner applies this and regenerates
-- supabase/schema-fingerprint.sha256 in the same change.
-- =========================================================================
--
-- The pointers go on the submission, not on the signing request. The
-- submission is already the process record: it owns status, revision,
-- recipient_email, released_at and the compare-and-swap in
-- lib/template-release.ts that decides who dispatches first. Putting the
-- pointers here means that one claim guards both delivery modes. It also
-- keeps the dependency one-way: this flow knows about signing, and
-- firm_signing_requests stays a generic record that knows nothing about
-- templates, so it remains usable for a plainly uploaded document.
--
-- The partial index is the price of that direction. The completion path
-- has to answer "which submission produced this signing request", which
-- with the pointer on this side is a scan.

alter table public.firm_template_submissions
  -- The rendered PDF, filed as a real document row. Null for a submission
  -- released as an encrypted share, and for every submission filed before
  -- this shipped.
  add column if not exists document_id uuid
    references public.firm_documents(id) on delete set null,
  -- The signature request the approval dispatched, when the template asks
  -- for a signature rather than a read-only share.
  add column if not exists signing_request_id uuid
    references public.firm_signing_requests(id) on delete set null,
  -- Copied from firm_templates.category at submission time, not joined at
  -- read time. The template can be recategorised or archived later and the
  -- submission must keep the category it was filed under.
  add column if not exists category text,
  -- The per-firm ticket number. Nullable and never backfilled: rows filed
  -- before this shipped keep the cosmetic REQ- reference they were emailed
  -- under, and assigning them numbers in an arbitrary order now would put
  -- a false sequence on the record.
  add column if not exists ticket_number text;

create index if not exists firm_template_submissions_signing_request_idx
  on public.firm_template_submissions (signing_request_id)
  where signing_request_id is not null;

create index if not exists firm_template_submissions_category_idx
  on public.firm_template_submissions (firm_id, category, submitted_at desc);

-- One number per firm, enforced by the database rather than by the
-- allocator's own care. lib/invoicing.ts sets the precedent: the retry
-- loop is only safe because a unique constraint exists to lose against.
-- Partial, so the rows with no number do not all collide on null.
create unique index if not exists firm_template_submissions_ticket_idx
  on public.firm_template_submissions (firm_id, ticket_number)
  where ticket_number is not null;

-- Whether output from this template is delivered as a read-only encrypted
-- share or sent for signature. Defaults to 'share', which is exactly what
-- every existing template does today, so this column changes no behaviour
-- until a firm opts a template in.
alter table public.firm_templates
  add column if not exists delivery_mode text not null default 'share'
    check (delivery_mode in ('share', 'signature'));

-- The per-firm ticket prefix. firm_settings is the existing home for
-- per-firm configuration that is not branding.
alter table public.firm_settings
  add column if not exists ticket_prefix text;

alter table public.firm_signatures
  -- Signing order within one request. Null means "no order", which is what
  -- every existing row means and what every existing request continues to
  -- do: all signers are invited at once. A numbered signer is invited only
  -- once every lower number has signed, and the write in
  -- lib/signature-write.ts refuses a signature out of turn, so the order is
  -- enforced rather than merely displayed.
  --
  -- Nullable with no default and no backfill, on purpose. Every row that
  -- exists reads as null, so every request already out for signature keeps
  -- behaving exactly as it did, and a firm that has not applied this file
  -- sees today's product. lib/signer-order.ts is the whole rule.
  add column if not exists signer_order int;
