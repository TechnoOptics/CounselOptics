import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPolicyCorpus } from '../lib/policy-corpus';

const codeOf = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/**
 * Which of a firm's policies actually reach the model.
 *
 * THE DEFECT THIS EXISTS FOR. checkAgainstPoliciesAction built its corpus by
 * walking the policies in name order and calling `break` on the first one that
 * would overflow the cap. `break` and not `continue`, so a single long policy
 * early in the alphabet silently excluded EVERY policy after it, and the
 * checker still reported a confidence score as though it had read them all.
 * A check that quietly measured against two of three policies is worse than
 * one that measured against none, because it reads as complete.
 *
 * So the allocation is fair rather than first-come: every policy gets a share
 * of the cap, small ones release what they do not use, and a policy that has
 * to be cut is REPORTED as cut rather than vanishing.
 */

const policy = (name: string, len: number) => ({
  name,
  content: 'x'.repeat(len),
});

describe('every policy is represented, not just the ones before the long one', () => {
  it('includes them all when they fit', () => {
    const out = buildPolicyCorpus(
      [policy('Acceptable Use', 100), policy('Data Protection', 100)],
      10_000,
    );
    expect(out.included).toEqual(['Acceptable Use', 'Data Protection']);
    expect(out.truncated).toEqual([]);
    expect(out.omitted).toEqual([]);
    expect(out.corpus).toContain('Acceptable Use');
    expect(out.corpus).toContain('Data Protection');
  });

  /**
   * The regression. Under the old `break`, "Anti-Bribery" consumed the cap and
   * "Data Protection" and "Expenses" never reached the model at all, unnamed.
   *
   * Mutation: allocate first-come and `break` on overflow. This goes red.
   */
  it('does not let one long early policy exclude the later ones', () => {
    const out = buildPolicyCorpus(
      [
        policy('Anti-Bribery', 9_000),
        policy('Data Protection', 200),
        policy('Expenses', 200),
      ],
      3_000,
    );
    expect(out.corpus).toContain('Data Protection');
    expect(out.corpus).toContain('Expenses');
    expect(out.included).toContain('Data Protection');
    expect(out.included).toContain('Expenses');
    expect(out.truncated).toContain('Anti-Bribery');
  });

  /**
   * Mutation: report a cut policy as included. This goes red, and it is the
   * assertion that makes the reported list trustworthy.
   */
  it('reports a policy it had to cut rather than passing it off as whole', () => {
    const out = buildPolicyCorpus([policy('Anti-Bribery', 9_000)], 2_000);
    expect(out.truncated).toEqual(['Anti-Bribery']);
    expect(out.included).toEqual([]);
  });

  it('never exceeds the cap', () => {
    const out = buildPolicyCorpus(
      [policy('A', 50_000), policy('B', 50_000), policy('C', 50_000)],
      4_000,
    );
    expect(out.corpus.length).toBeLessThanOrEqual(4_000);
  });

  it('keeps the firm\'s own order so the reported list matches the prompt', () => {
    const out = buildPolicyCorpus(
      [policy('Zebra', 40), policy('Alpha', 40)],
      10_000,
    );
    expect(out.corpus.indexOf('Zebra')).toBeLessThan(out.corpus.indexOf('Alpha'));
    expect(out.included).toEqual(['Zebra', 'Alpha']);
  });

  /**
   * Fixed where it lives, so BOTH readers of the policy library benefit: the
   * employee document checker that had the defect, and the ticket analysis
   * added alongside it. Copying the corpus loop into the second call site
   * would have duplicated a known bug.
   *
   * Mutation: restore the hand-rolled loop in lib/firm-policies.ts. This
   * goes red.
   */
  it('is the only corpus builder, including in the employee checker', () => {
    const checker = codeOf('lib/firm-policies.ts');
    expect(checker).toContain('buildPolicyCorpus');
    expect(checker).not.toMatch(/corpus\.length \+ chunk\.length/);
    expect(checker).not.toMatch(/\bbreak;\s*\n\s*}\s*\n\s*corpus \+= chunk/);
  });

  it('handles a firm with no policies', () => {
    const out = buildPolicyCorpus([], 10_000);
    expect(out.corpus).toBe('');
    expect(out.included).toEqual([]);
    expect(out.truncated).toEqual([]);
    expect(out.omitted).toEqual([]);
  });

  /**
   * With more policies than the cap can seat, the ones with no room are named
   * as omitted. Silence is the one outcome that is not allowed.
   */
  it('names the policies it could not seat at all', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      policy(`Policy ${String(i).padStart(2, '0')}`, 500),
    );
    const out = buildPolicyCorpus(many, 300);
    const accounted =
      out.included.length + out.truncated.length + out.omitted.length;
    expect(accounted).toBe(40);
    expect(out.omitted.length).toBeGreaterThan(0);
  });
});
