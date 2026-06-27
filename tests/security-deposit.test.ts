import { describe, it, expect } from 'vitest';
import { DEPOSIT_RULES, getDepositRule } from '../lib/security-deposit-rules';

const ENTITY_RE = /&(ldquo|rdquo|rsquo|lsquo|amp|ndash|mdash|hellip);/;

describe('security-deposit rules', () => {
  it('has rules for multiple states', () => {
    expect(DEPOSIT_RULES.length).toBeGreaterThan(0);
  });

  it('getDepositRule finds a known rule and returns null otherwise', () => {
    const first = DEPOSIT_RULES[0];
    expect(getDepositRule(first.slug)).toMatchObject({ slug: first.slug });
    expect(getDepositRule('nowhere')).toBeNull();
  });

  it('every slug is unique', () => {
    const slugs = DEPOSIT_RULES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('contains no raw HTML entities', () => {
    expect(JSON.stringify(DEPOSIT_RULES)).not.toMatch(ENTITY_RE);
  });
});
