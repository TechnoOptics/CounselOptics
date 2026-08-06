import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every export of a `'use server'` module is a public HTTP endpoint, callable
 * by any signed-in user with arguments of their own choosing, and every write
 * in lib/template-submissions.ts goes through the service-role client, which
 * bypasses RLS. So the action itself is the whole of the authorization.
 *
 * This reads the module as text rather than running it. That is deliberate:
 * the actions pull in next/cache, both Supabase clients, entitlements,
 * notifications and rate limiting, so exercising them would need a large mock
 * harness that tests the harness as much as the code. What actually goes wrong
 * here is an author adding an action and forgetting the check that every
 * sibling performs, and a structural assertion catches exactly that, cheaply.
 *
 * It is a floor, not a proof: it says an authorization helper is named, not
 * that the right one was used on the right firm. Read the action too.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('../lib/template-submissions.ts', import.meta.url)),
  'utf8',
);

/** Each exported action with its body, up to the next top-level declaration. */
function exportedActions(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /^export async function (\w+)\(/gm;
  const starts: { name: string; at: number }[] = [];
  for (const m of SOURCE.matchAll(re)) {
    starts.push({ name: m[1], at: m.index ?? 0 });
  }
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].at : SOURCE.length;
    out.push({ name: starts[i].name, body: SOURCE.slice(starts[i].at, end) });
  }
  return out;
}

describe('lib/template-submissions.ts', () => {
  it('exposes the actions the approval flow needs', () => {
    const names = exportedActions().map((a) => a.name);
    expect(names).toContain('submitTemplateForApprovalAction');
    expect(names).toContain('decideTemplateSubmissionAction');
    expect(names).toContain('resubmitTemplateSubmissionAction');
    expect(names).toContain('withdrawTemplateSubmissionAction');
    expect(names).toContain('retryTemplateReleaseAction');
    expect(names).toContain('editTemplateSubmissionAction');
  });

  it('keeps the employee original when a reviewer edits, rather than replacing it', () => {
    const edit = exportedActions().find((a) => a.name === 'editTemplateSubmissionAction');
    expect(edit).toBeTruthy();
    // Written only when reviewEdit said this is the first edit. Writing it
    // unconditionally would overwrite the employee's text with the previous
    // reviewer's on the second edit.
    expect(edit?.body).toMatch(
      /edit\.preserveOriginal\s*\?\s*\{\s*original_document_text:\s*seen\s*\}/,
    );
  });

  it('swaps the edit and the decision against the version the reviewer saw', () => {
    // The baseline is `seenRev`, the revision the reviewer's page rendered, NOT
    // `row.revision`, which the action itself read a moment earlier. The second
    // only closes the milliseconds between an action's own read and its own
    // write; the window that matters is the minutes a reviewer spends with the
    // document open, and only the first closes that.
    //
    // tests/template-submission-concurrency.test.ts is what proves this works.
    // These assertions exist so the wrong baseline cannot creep back in while
    // a behavioural test that no longer reaches it keeps passing.
    for (const name of ['editTemplateSubmissionAction', 'decideTemplateSubmissionAction']) {
      const action = exportedActions().find((a) => a.name === name);
      expect(action?.body).toMatch(/\.eq\('status',\s*'pending'\)/);
      expect(action?.body).toMatch(/\.eq\('revision',\s*seenRev\)/);
      expect(action?.body).not.toMatch(/\.eq\('revision',\s*row\.revision\)/);
    }
  });

  it('never puts the document body in a filter', () => {
    // A PostgREST filter is a query-string parameter on a PATCH exactly as on
    // a GET, so `.eq('document_text', ...)` percent-encodes the whole merged
    // agreement into the request URL. postgrest-js carries its own 8000
    // character limit and has no fallback below it, so a real mutual NDA would
    // fail the write on every ordinary document rather than on a race. The
    // revision carries the same guarantee in a few bytes.
    expect(SOURCE).not.toMatch(/\.eq\('document_text',/);
  });

  it('clears any reviewer edit when the employee resubmits', () => {
    // A resubmission is a new document, so a previous reviewer's wording is
    // gone and the preserved "what the employee submitted" would otherwise
    // point at the wrong revision.
    const resubmit = exportedActions().find(
      (a) => a.name === 'resubmitTemplateSubmissionAction',
    );
    expect(resubmit?.body).toMatch(/original_document_text:\s*null/);
    expect(resubmit?.body).toMatch(/edited_by:\s*null/);
    expect(resubmit?.body).toMatch(/edited_at:\s*null/);
  });

  it('authorizes the caller against the firm in every exported action', () => {
    const unguarded = exportedActions()
      .filter((a) => !/authorizeFirmActor|callerFirmRole/.test(a.body))
      .map((a) => a.name);
    expect(unguarded).toEqual([]);
  });

  it('never trusts a firm role passed in by the caller', () => {
    // The role always comes from the caller's own membership row, never from
    // an argument, so a caller cannot hand themselves an approving role.
    expect(SOURCE).not.toMatch(/\brole\s*[:?]\s*FirmRole/);
  });
});
