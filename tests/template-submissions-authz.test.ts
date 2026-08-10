import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

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

/**
 * Comments are removed before anything is matched. Read raw, the authorization
 * sweep below was satisfied by the WORD `callerFirmRole`: replacing the real
 * call in getTemplateSubmissionAction with the comment "callerFirmRole is
 * enforced by the page that calls this" left an unauthorized `'use server'`
 * export returning a submission, and the guard green.
 */
const SOURCE = stripComments(
  readFileSync(
    fileURLToPath(new URL('../lib/template-submissions.ts', import.meta.url)),
    'utf8',
  ),
);

/**
 * Each exported action with its body.
 *
 * A body ends at the next top-level declaration of ANY kind, not at the next
 * exported action. Ending it at the next export gave the last action a body
 * that ran to end of file and swallowed the four private helpers below it, so
 * an authorization helper named in any of those would have satisfied the sweep
 * on behalf of whichever action happened to be last.
 */
function exportedActions(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const exportRe = /^export async function (\w+)\(/gm;
  const topLevelRe = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface)\b/gm;
  const starts: { name: string; at: number }[] = [];
  for (const m of SOURCE.matchAll(exportRe)) {
    starts.push({ name: m[1], at: m.index ?? 0 });
  }
  const tops = [...SOURCE.matchAll(topLevelRe)].map((m) => m.index ?? 0);
  for (const { name, at } of starts) {
    const next = tops.find((i) => i > at) ?? SOURCE.length;
    out.push({ name, body: SOURCE.slice(at, next) });
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
    const actions = exportedActions();
    // The floor. If the export scan ever stops matching, `unguarded` is empty
    // and this passes without having looked at a single action.
    expect(actions.length).toBeGreaterThanOrEqual(6);
    const unguarded = actions
      // The CALL, not the name: a comment naming the helper is not a check.
      .filter((a) => !/\b(?:authorizeFirmActor|callerFirmRole)\s*\(/.test(a.body))
      .map((a) => a.name);
    expect(unguarded).toEqual([]);
  });

  it('never trusts a firm role passed in by the caller', () => {
    // The role always comes from the caller's own membership row, never from
    // an argument, so a caller cannot hand themselves an approving role.
    expect(SOURCE).not.toMatch(/\brole\s*[:?]\s*FirmRole/);
  });
});
