import { describe, it, expect } from 'vitest';
import {
  STATES_SMALL_CLAIMS,
  getStateSmallClaims,
} from '../lib/state-small-claims';

const ENTITY_RE = /&(ldquo|rdquo|rsquo|lsquo|amp|ndash|mdash|hellip);/;

describe('state small-claims data', () => {
  it('covers at least the 50 states', () => {
    expect(STATES_SMALL_CLAIMS.length).toBeGreaterThanOrEqual(50);
  });

  it('getStateSmallClaims finds a known state and returns null otherwise', () => {
    expect(getStateSmallClaims('california')).toMatchObject({ slug: 'california' });
    expect(getStateSmallClaims('atlantis')).toBeNull();
  });

  it('every slug is unique', () => {
    const slugs = STATES_SMALL_CLAIMS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every entry has sane, required fields', () => {
    for (const s of STATES_SMALL_CLAIMS) {
      expect(s.slug).toMatch(/^[a-z-]+$/);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.abbr).toMatch(/^[A-Z]{2}$/);
      expect(s.monetaryLimit).toBeGreaterThan(0);
      expect(['Yes', 'No', 'Limited']).toContain(s.attorneysAllowed);
      expect(s.appealWindowDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('contains no raw HTML entities', () => {
    expect(JSON.stringify(STATES_SMALL_CLAIMS)).not.toMatch(ENTITY_RE);
  });
});
