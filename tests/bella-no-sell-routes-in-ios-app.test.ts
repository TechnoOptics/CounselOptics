import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Bella can send a person anywhere in the app with navigate_to. Inside the
 * iOS app the product sells nothing, and middleware already turns a sell-only
 * route into a redirect home there. So a navigate_to('/pricing') from Bella on
 * iOS was a narrated trip to a page that does not exist for that reader, and
 * her own site map described /billing as "tier and subscription", which is an
 * offer in everything but markup.
 *
 * These assertions read comment-stripped source and check CALLS, not names.
 * A comment that mentions isIosSellRoute must not satisfy them, and an import
 * line must not either.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bella = stripComments(readFileSync(join(root, 'lib/bella.ts'), 'utf8'));
const route = stripComments(
  readFileSync(join(root, 'app/api/bella/route.ts'), 'utf8'),
);

/** The navigate_to branch of executeTool, and only that branch. */
function navigateBranch(): string {
  const start = bella.indexOf("if (name === 'navigate_to') {");
  expect(start, 'navigate_to branch not found').toBeGreaterThan(-1);
  const end = bella.indexOf('return { ok: true, navigated_to: path };', start);
  expect(end, 'navigate_to success return not found').toBeGreaterThan(start);
  return bella.slice(start, end);
}

describe('navigate_to inside the iOS app', () => {
  it('refuses a sell-only route, keyed on the platform the route read', () => {
    const branch = navigateBranch();
    expect(branch).toMatch(/platform === 'ios' && isIosSellRoute\(path\)/);
  });

  it('names no destination in its refusal', () => {
    const branch = navigateBranch();
    const refusal = branch.match(/error:\s*'([^']+)'/g) ?? [];
    expect(refusal.length).toBeGreaterThan(0);
    for (const r of refusal) {
      expect(r).not.toMatch(/\/pricing|\/billing|\/gift|advottic\.com|upgrade|subscribe|top up/i);
    }
  });

  it('gets the platform from the request user agent, not a default', () => {
    expect(route).toMatch(
      /platform:\s*nativePlatformFromUserAgent\(req\.headers\.get\('user-agent'\)\)/,
    );
    expect(bella).toMatch(/const platform[^=]*=\s*input\.platform \?\? 'web'/);
  });

  it('threads the platform into every tool call', () => {
    const call = bella.match(/await executeTool\(([\s\S]*?)\);/);
    expect(call, 'executeTool call not found').not.toBeNull();
    expect(call![1]).toMatch(/\bplatform,?\s*$/m);
  });
});

describe("Bella's site map", () => {
  it('does not describe /billing as a place to subscribe', () => {
    const line = bella.split('\n').find((l) => l.includes('/billing - '));
    expect(line, 'site map line for /billing not found').toBeDefined();
    expect(line!).not.toMatch(/subscription|subscribe|upgrade|tier/i);
  });
});
