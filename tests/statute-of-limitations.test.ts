import { describe, it, expect } from 'vitest';
import {
  getState,
  getClaimType,
  formatYears,
  STATES_SOL,
  CLAIM_TYPES,
} from '../lib/statute-of-limitations';

const ENTITY_RE = /&(ldquo|rdquo|rsquo|lsquo|amp|ndash|mdash|hellip);/;

describe('statute-of-limitations lookups', () => {
  it('getState returns the matching state by slug', () => {
    const first = STATES_SOL[0];
    expect(getState(first.slug)).toMatchObject({ slug: first.slug });
  });

  it('getState returns null for an unknown slug', () => {
    expect(getState('not-a-real-state')).toBeNull();
  });

  it('getClaimType returns the matching claim by id', () => {
    const first = CLAIM_TYPES[0];
    expect(getClaimType(first.id)).toMatchObject({ id: first.id });
  });

  it('getClaimType returns null for an unknown id', () => {
    expect(getClaimType('nope')).toBeNull();
  });

  it('formatYears returns a non-empty string', () => {
    expect(typeof formatYears(2)).toBe('string');
    expect(formatYears(2).length).toBeGreaterThan(0);
  });
});

describe('statute-of-limitations data integrity', () => {
  it('has states and claim types', () => {
    expect(STATES_SOL.length).toBeGreaterThanOrEqual(50);
    expect(CLAIM_TYPES.length).toBeGreaterThan(0);
  });

  it('every state slug is unique', () => {
    const slugs = STATES_SOL.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // Regression guard: literal HTML entities in this data render as raw
  // text in the SOL checker and leak into the FAQ JSON-LD. They must
  // stay as real Unicode characters.
  it('contains no raw HTML entities', () => {
    expect(JSON.stringify(STATES_SOL)).not.toMatch(ENTITY_RE);
    expect(JSON.stringify(CLAIM_TYPES)).not.toMatch(ENTITY_RE);
  });
});
