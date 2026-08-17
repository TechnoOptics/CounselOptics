import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every prefix setting is a public HTTP endpoint, and each one must prove the
 * caller runs the firm before it writes.
 *
 * `lib/firm-settings-actions.ts` is a `'use server'` module, so every export in
 * it is callable by anyone who can reach the site, with arguments of their
 * choosing. Each of these actions takes a firmId as an ARGUMENT and then writes
 * to that firm's settings with the admin client, which is the exact shape that
 * has produced the worst defects in this codebase: a write past RLS gated only
 * by a UI that happens to pass the right id.
 *
 * A caller must not be able to rename another firm's reference prefix. Doing so
 * would change the letters on every reference that firm issues from then on,
 * which is a defacement of a legal record visible to their counterparties.
 *
 * Comments are stripped before matching, because a guard satisfied by the prose
 * describing a check rather than by the check is not a guard.
 */

function codeOnly(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The body of one exported action, from its signature to the next export. */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) return '';
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\nexport ');
  return end < 0 ? rest : rest.slice(0, end);
}

const ACTIONS = [
  'updateFirmTicketPrefixAction',
  'updateFirmMatterPrefixAction',
  'updateFirmRequestPrefixAction',
];

describe('changing a firm reference prefix', () => {
  const source = codeOnly('lib/firm-settings-actions.ts');

  it.each(ACTIONS)('%s exists', (name) => {
    expect(actionBody(source, name)).not.toBe('');
  });

  it.each(ACTIONS)('%s refuses a caller who does not run the firm', (name) => {
    const body = actionBody(source, name);
    expect(body).toMatch(/callerIsFirmAdmin\s*\(\s*firmId\s*\)/);
  });

  /**
   * The check has to come before the write, not merely be present in the
   * function. An authorization check after the upsert authorizes nothing.
   */
  it.each(ACTIONS)('%s checks before it writes', (name) => {
    const body = actionBody(source, name);
    const check = body.indexOf('callerIsFirmAdmin');
    const write = body.indexOf('.upsert(');
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
  });

  /**
   * The stored value is normalised on the way IN, not only when it is read
   * back, so a caller cannot smuggle punctuation, an empty string or a
   * hundred-character prefix into the column and have it appear on documents.
   */
  it.each(ACTIONS)('%s normalises what it stores', (name) => {
    const body = actionBody(source, name);
    expect(body).toMatch(/normalize(Ticket|Matter|Request)Prefix\s*\(/);
  });
});

describe('the body reader this file depends on', () => {
  /**
   * If actionBody silently returned '' the assertions above would all be
   * vacuous, so it is pinned against a function that is known to be there.
   */
  it('finds a real action and stops at the next export', () => {
    const source = codeOnly('lib/firm-settings-actions.ts');
    const body = actionBody(source, 'updateFirmTicketPrefixAction');
    expect(body).toContain('ticket_prefix');
    expect(body).not.toContain('matter_prefix');
  });
});
