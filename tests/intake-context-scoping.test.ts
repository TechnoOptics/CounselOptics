import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The ticket rail's context panels, and the one way they could leak.
 *
 * The live policies, read from pg_policies on 2026-08-16:
 *
 *   firm_documents_member_select          owner, admin, attorney, paralegal
 *   firm_signing_requests_member_select   any firm member, NO role filter
 *   firm_matter_intakes_member            any firm member, NO role filter
 *
 * supabase/migrations/20260731_staff_role_read_scope.sql deliberately
 * screened `staff` out of firm documents, because the product promises a
 * staff member "read-only access to non-privileged surfaces" in writing at
 * the moment they are invited. firm_signing_requests never got the matching
 * filter.
 *
 * So a "Signed documents" panel that starts from firm_signing_requests and
 * joins outward to document names hands a receptionist the name of every
 * document in the firm and whether it has been signed. Starting from
 * firm_documents and looking up signing requests only for the ids it
 * returned makes the documents policy the gate.
 *
 * Anchors strip comments first. This repo has repeatedly had source-reading
 * guards pass because the comment explaining the fix contained the string
 * the guard was searching for, so the prose above must not be able to
 * satisfy anything below.
 *
 * Mutations that must turn these red, each verified by hand:
 *   - swap the two queries in loadTicketSigningActivity so the signing
 *     requests are read first;
 *   - drop the `.in('document_id', ...)` filter;
 *   - change either call site to pass an admin client;
 *   - import createAdminSupabase into lib/intake-context.ts.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const context = () => stripComments(read('../lib/intake-context.ts'));
const counselPage = () =>
  stripComments(read('../app/counsel/intake/[id]/page.tsx'));

describe('the signed-documents lookup is gated by firm_documents', () => {
  it('reads firm_documents before firm_signing_requests', () => {
    const code = context();
    const docs = code.indexOf("from('firm_documents')");
    const reqs = code.indexOf("from('firm_signing_requests')");
    expect(docs, 'firm_documents is never queried').toBeGreaterThan(-1);
    expect(reqs, 'firm_signing_requests is never queried').toBeGreaterThan(-1);
    expect(
      docs,
      'firm_signing_requests is read before firm_documents, so the documents policy is no longer the gate',
    ).toBeLessThan(reqs);
  });

  it('filters the signing requests by the document ids it was allowed to read', () => {
    expect(context()).toMatch(/\.in\(\s*'document_id'\s*,/);
  });

  it('scopes the documents query to this one ticket', () => {
    expect(context()).toMatch(/from\('firm_documents'\)[\s\S]{0,200}?\.eq\(\s*'intake_id'\s*,\s*intakeId\s*\)/);
  });

  it('returns early when the reader may see no documents, so step two never runs', () => {
    // A `staff` member gets [] from step one. Without this the code would
    // fall through to `.in('document_id', [])`, which is harmless today but
    // stops being harmless the moment somebody "optimises" the empty case.
    expect(context()).toMatch(/docs\.length === 0\s*\)?\s*return \[\]/);
  });

  it('never reaches for the service-role client', () => {
    const code = context();
    expect(code).not.toMatch(/createAdminSupabase/);
    expect(code).not.toMatch(/supabase\/admin/);
    expect(code).not.toMatch(/SERVICE_ROLE/);
  });
});

describe('the call site passes the RLS-enforced client', () => {
  it('builds its client with createServerSupabase', () => {
    expect(counselPage()).toMatch(
      /const supabase = createServerSupabase\(\)/,
    );
  });

  it('hands that same client to both context loaders', () => {
    const code = counselPage();
    expect(code).toMatch(/loadTicketSigningActivity\(\s*supabase\s*,/);
    expect(code).toMatch(/loadRequesterOtherIntakes\(\s*supabase\s*,/);
  });

  it('does not pass an admin client to either', () => {
    const code = counselPage();
    expect(code).not.toMatch(/loadTicketSigningActivity\(\s*admin/);
    expect(code).not.toMatch(/loadRequesterOtherIntakes\(\s*admin/);
  });
});

describe("the requester's history stays inside one firm and one person", () => {
  it('filters on both the firm and the requester, and excludes this ticket', () => {
    const code = context();
    expect(code).toMatch(/\.eq\(\s*'firm_id'\s*,\s*intake\.firm_id\s*\)/);
    expect(code).toMatch(/\.eq\(\s*'created_by'\s*,\s*intake\.created_by\s*\)/);
    expect(code).toMatch(/\.neq\(\s*'id'\s*,\s*intake\.id\s*\)/);
  });

  it('returns nothing rather than everything when there is no requester', () => {
    // Without the guard, `.eq('created_by', null)` is not a no-op filter in
    // postgrest, but relying on that is a bet. The early return is the
    // behaviour that is actually intended.
    expect(context()).toMatch(/if \(!intake\.created_by\) return \[\]/);
  });
});

describe('the empty states do not imply a feature', () => {
  it('renders neither panel when it has nothing to list', () => {
    const code = counselPage();
    expect(code).toMatch(/\{signing\.length > 0 && \(/);
    expect(code).toMatch(/\{requesterHistory\.length > 0 && \(/);
  });
});
