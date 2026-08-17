import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A request is a ticket, not a matter waiting to be opened.
 *
 * THIS IS A DELIBERATE REMOVAL OF A SHIPPED WRITE PATH, NOT A REGRESSION.
 * The owner, who is an in-house GC, was explicit: an in-house team answers
 * requests and does not take them on as matters, and he does not expect that
 * to change. So "Take it on as a matter" and convertIntakeToCaseAction are
 * gone on purpose, and these guards exist so nobody restores them believing
 * they are repairing something.
 *
 * THE READ PATH SURVIVES ON PURPOSE, AND SO DOES THE COLUMN. Two production
 * requests were genuinely converted before this change, both linked cases
 * still exist, and one was touched the day this shipped.
 * firm_matter_intakes.case_id therefore still carries real data, and the
 * ticket still links to the matter it produced wherever case_id is set.
 * The column is NOT orphaned and must not be "tidied" away: deleting it, or
 * dropping the link, would hide two live matters from the only screen that
 * points at them.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

const codeOf = (rel: string) => stripComments(read(rel));
const exists = (rel: string) =>
  existsSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)));

const PAGE = 'app/counsel/intake/[id]/page.tsx';

describe('the write path that turned a request into a matter is gone', () => {
  /**
   * Mutation: restore the file. This goes red.
   */
  it('has no convert-to-matter component', () => {
    expect(exists('app/counsel/intake/[id]/convert-to-matter.tsx')).toBe(false);
  });

  /**
   * The server action is deleted and not merely unreferenced. Leaving it
   * exported would leave the conversion reachable: every 'use server' export
   * is a public HTTP endpoint, so an unused action is still a live one.
   *
   * Mutation: re-export it from lib/firm-actions.ts. This goes red.
   */
  it('no longer exports the conversion action anywhere', () => {
    expect(codeOf('lib/firm-actions.ts')).not.toContain(
      'export async function convertIntakeToCaseAction',
    );
  });

  it('offers no way to take a request on from the ticket', () => {
    const code = codeOf(PAGE);
    expect(code).not.toContain('ConvertToMatter');
    expect(code).not.toContain('convertIntakeToCase');
  });
});

describe('a request that already became a matter still points at it', () => {
  /**
   * The surviving read path. It is a plain link in the Matter panel, drawn
   * only when case_id is set, and it is the ONLY thing keeping the two
   * converted requests connected to their cases.
   *
   * Mutation: drop the caseId link from the Matter panel. This goes red, and
   * it is the assertion that stops the removal orphaning live data.
   */
  it('links to the matter wherever case_id is set', () => {
    const code = codeOf(PAGE);
    expect(code).toContain('caseId');
    expect(code).toContain('/counsel/cases/${caseId}');
    expect(code).toContain('Open the matter');
  });

  /**
   * Drawn once. It used to be in the action bar AND the Matter panel, which
   * docs/DESIGN.md calls out as a control drawn twice.
   */
  it('draws that link exactly once', () => {
    const hits = codeOf(PAGE).match(/Open the matter/g) ?? [];
    expect(hits).toHaveLength(1);
  });
});
