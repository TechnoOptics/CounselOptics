import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Bella must not expose firm_access_requests to a firm workspace.
 *
 * THE BUG. `list_access_requests` was in FIRM_ONLY, so the dispatch guard
 * admitted any member of any firm and refused HQ admin, whose table it is.
 * The loader it reached took no firmId and applied no filter, so it returned
 * every organization's inbound request through the service-role client:
 * organization name, contact name, contact email, contact role, firm type,
 * team size, jurisdictions. The stale comment claiming the firm loaders ran
 * under RLS is why nobody added a scope check.
 *
 * WHY REMOVED AND NOT GATED. firm_access_requests is an HQ table. Its other
 * readers are app/admin/counsel-requests/page.tsx, which redirects unless
 * isCurrentUserAdmin(), and lib/hq-storage.ts. No HQ surface ever called the
 * Bella tool and none could, so there was no capability to preserve.
 *
 * TWO CLAIMS, ASSERTED SEPARATELY, because only one of them was the bug.
 * The guard ran in the right ORDER all along and still produced the wrong
 * OUTCOME, so "the caller is refused" and "the loader is never reached" are
 * not the same statement and one can regress without the other.
 *
 * These are static assertions over the source, matching how the rest of this
 * repo guards lib/bella.ts: the module is `server-only` and pulls in the
 * Anthropic SDK, so no test in this repo executes executeTool. They prove the
 * tool is absent and that absence lands on a refusal, not that a live request
 * was rejected.
 *
 * Source is comment-stripped via the shared helper, so the prose above and
 * the note in executeTool cannot satisfy any of these.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = stripComments(readFileSync(join(repoRoot, 'lib/bella.ts'), 'utf8'));

describe('lib/bella.ts and the HQ access-request table', () => {
  it('never reaches the loader: no code path reads firm_access_requests', () => {
    expect(source).not.toContain('firm_access_requests');
    expect(source).not.toContain('loadAccessRequests');
  });

  it('refuses the caller: the tool is not offered to any portal', () => {
    // Covers the ToolName union, the LIST_ACCESS_REQUESTS_TOOL schema,
    // toolsFor, the FIRM_ONLY set, the dispatch, and the routing table inside
    // buildFirmAddendum. The addendum is a template literal, not a comment,
    // so a line advertising the tool to the model would still be caught here.
    expect(source).not.toContain('list_access_requests');
    expect(source).not.toContain('LIST_ACCESS_REQUESTS_TOOL');
  });

  it('keeps the refusal fallback that makes absence mean "no"', () => {
    // Removing a tool is only equivalent to refusing it while executeTool
    // ends in an explicit refusal. If that fallback were ever replaced by a
    // permissive default, an undispatched name would stop being an error.
    expect(source).toContain('return { ok: false, error: `Unknown tool: ${name}` };');
  });
});
