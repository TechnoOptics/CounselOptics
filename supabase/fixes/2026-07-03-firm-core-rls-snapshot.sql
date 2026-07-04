-- FIRM-CORE RLS SNAPSHOT (reviewable tenant boundary).
--
-- The audit (2026-07-03) flagged that the firm-core tables and their
-- RLS live only in the Supabase dashboard, never in source - so the
-- multi-tenant boundary (the single most important property of this
-- app) could not be code-reviewed and could silently drift.
--
-- This file is a verbatim snapshot of the LIVE policies as of
-- 2026-07-03, pulled from pg_policies, so the boundary is now
-- reviewable in git. It is NOT meant to be re-applied blindly (the
-- tables already exist in prod); it is the reference of record. A
-- follow-up should add the full CREATE TABLE DDL for these tables too.
--
-- Reading guide: every firm-scoped table authorizes through an EXISTS
-- against firm_members (the caller must be a member of the row's
-- firm_id, often with a role in a posting/admin set). Money + signature
-- tables expose only SELECT to members; their writes go exclusively
-- through SECURITY DEFINER RPCs / the service-role client, so there is
-- deliberately NO INSERT/UPDATE/DELETE policy on them (RLS denies
-- direct writes). The firm_members INSERT policy below is the tightened
-- version from 2026-07-03-firm-members-insert-tenant-takeover-fix.sql.

-- ── firms ────────────────────────────────────────────────────────────
-- INSERT firms_self_insert            WITH CHECK (created_by = auth.uid())
-- SELECT firms_member_select          USING  (caller is a firm_member of firms.id)
-- SELECT firms_public_tenant_select   USING  (subdomain_enabled = true)
-- UPDATE firms_owner_update           USING  (caller is owner/admin of firms.id)
--
-- REVIEW ITEM: firms_public_tenant_select exposes EVERY column of any
-- subdomain-enabled firm to anon (needed for public tenant branding),
-- including token_pool_balance / created_by / metadata. Prefer a
-- SECURITY DEFINER RPC that returns only the public branding columns,
-- the same pattern the community pages use, so internal fields can't
-- leak by simply adding a column later.

-- ── firm_members (tenant boundary root) ──────────────────────────────
-- SELECT firm_members_visible_to_firm    USING  private.is_firm_member(firm_id, auth.uid())
-- INSERT firm_members_owner_admin_insert WITH CHECK private.is_firm_member_with_role(firm_id, auth.uid(), {owner,admin})
-- UPDATE firm_members_owner_admin_update USING  private.is_firm_member_with_role(firm_id, auth.uid(), {owner,admin})
-- DELETE firm_members_self_or_admin_delete USING (user_id = auth.uid() OR is owner/admin)

-- ── firm_documents ───────────────────────────────────────────────────
-- SELECT firm_documents_member_select  USING  (caller is a firm_member)
-- INSERT firm_documents_member_insert  WITH CHECK (caller role in {owner,admin,attorney,paralegal})
-- UPDATE firm_documents_member_update  USING  (caller role in {owner,admin,attorney,paralegal})

-- ── firm_signing_requests ────────────────────────────────────────────
-- SELECT firm_signing_requests_member_select USING (caller is a firm_member)
-- INSERT firm_signing_requests_member_insert WITH CHECK (role in {owner,admin,attorney,paralegal})
-- UPDATE firm_signing_requests_member_update USING (role in {owner,admin,attorney,paralegal})

-- ── firm_signatures (writes = service-role sign route only) ──────────
-- SELECT firm_signatures_member_select USING
--   (caller is a member of the request's firm OR signer_user_id = auth.uid())
-- (no INSERT/UPDATE/DELETE policy -> direct writes denied)

-- ── firm_signature_events (append-only audit; writes = definer/svc) ──
-- SELECT firm_signature_events_member_select USING
--   (caller is a member of the linked request's firm)

-- ── firm_invoices ────────────────────────────────────────────────────
-- SELECT firm_invoices_member_select USING (firm member OR client_user_id = auth.uid())
-- ALL    firm_invoices_member_write  USING/CHECK (role in {owner,admin,attorney})

-- ── firm_time_entries (immutable once invoiced) ──────────────────────
-- SELECT firm_time_entries_member_select USING (caller is a firm_member)
-- ALL    firm_time_entries_self_write
--        USING  (user_id = auth.uid() AND invoice_id IS NULL AND member of firm)
--        CHECK  (user_id = auth.uid() AND member of firm)
--   -> the `invoice_id IS NULL` in USING is what makes an invoiced
--      entry immutable at the RLS layer (can't update/delete once billed)

-- ── firm_trust_accounts (writes = members with role) ─────────────────
-- ALL firm_trust_accounts_member USING/CHECK (role in {owner,admin,attorney})

-- ── firm_trust_transactions (writes = post_trust_transaction RPC) ────
-- SELECT firm_trust_transactions_select USING (role in {owner,admin,attorney,paralegal})
-- (no write policy -> direct INSERT/UPDATE/DELETE denied; append only
--  via the advisory-locked SECURITY DEFINER RPC)

-- ── firm_trust_reconciliations (writes = create RPC) ─────────────────
-- SELECT firm_trust_reconciliations_select USING (role in {owner,admin,attorney,paralegal})

-- ── firm_invitations ─────────────────────────────────────────────────
-- SELECT/INSERT/DELETE firm_invitations_admin_* : role in {owner,admin}

-- Snapshot verified against pg_policies on 2026-07-03. No SQL is
-- executed by this file.
