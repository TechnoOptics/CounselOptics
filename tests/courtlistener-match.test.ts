import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  normalizeCaseName,
  partiesOf,
  caseNamesMatch,
  extractCitations,
} from '../lib/courtlistener-match';

/**
 * The CourtListener verifier is the safety gate that keeps a fabricated case
 * citation off the firm legal-review surface. These tests pin the network-free
 * matching logic it leans on: name normalisation, party splitting, the
 * conservative name-match, and citation extraction.
 *
 * The load-bearing invariant is that caseNamesMatch is CONSERVATIVE: it must
 * confirm a real record against a candidate that varies only in fullness of the
 * party names, and must NOT match two genuinely different cases (which would
 * let a wrong-but-real citation pose as the proposed one).
 */

describe('absoluteUrl', () => {
  it('prefixes a relative CourtListener path', () => {
    expect(absoluteUrl('/opinion/108713/roe-v-wade/')).toBe(
      'https://www.courtlistener.com/opinion/108713/roe-v-wade/',
    );
  });
  it('leaves an absolute URL untouched', () => {
    expect(absoluteUrl('https://www.courtlistener.com/opinion/1/x/')).toBe(
      'https://www.courtlistener.com/opinion/1/x/',
    );
  });
  it('returns null for empty input', () => {
    expect(absoluteUrl('')).toBeNull();
    expect(absoluteUrl(null)).toBeNull();
    expect(absoluteUrl(undefined)).toBeNull();
  });
});

describe('normalizeCaseName', () => {
  it('drops procedural suffixes, punctuation, and case', () => {
    expect(normalizeCaseName('Jane Roe, et al. v. Henry Wade')).toBe('jane roe v henry wade');
    expect(normalizeCaseName('Acme Corp. v. Widget, Inc.')).toBe('acme v widget');
  });
});

describe('partiesOf', () => {
  it('splits on v. into two sides', () => {
    expect(partiesOf('Roe v. Wade')).toEqual(['roe', 'wade']);
    expect(partiesOf('Brown v. Board of Education')).toEqual(['brown', 'board of education']);
  });
  it('returns null when there is no v. separator', () => {
    expect(partiesOf('In re Gault')).toBeNull();
  });
});

describe('caseNamesMatch', () => {
  it('matches names that differ only in party fullness', () => {
    expect(caseNamesMatch('Roe v. Wade', 'Jane Roe, et al. v. Henry Wade')).toBe(true);
    expect(caseNamesMatch('Miranda v. Arizona', 'Ernesto Miranda v. State of Arizona')).toBe(true);
  });
  it('is identity-stable and case-insensitive', () => {
    expect(caseNamesMatch('Brown v. Board of Education', 'brown v board of education')).toBe(true);
  });
  it('does NOT match two genuinely different cases', () => {
    expect(caseNamesMatch('Roe v. Wade', 'Miranda v. Arizona')).toBe(false);
    // Same plaintiff surname, entirely different defendant: must not confirm.
    expect(caseNamesMatch('Roe v. Wade', 'Roe v. Arizona')).toBe(false);
  });
  it('handles non-"v." styles by containment', () => {
    expect(caseNamesMatch('In re Gault', 'In re Gault')).toBe(true);
    expect(caseNamesMatch('In re Gault', 'In re Winship')).toBe(false);
  });
  it('rejects empty input', () => {
    expect(caseNamesMatch('', 'Roe v. Wade')).toBe(false);
  });
});

describe('extractCitations', () => {
  it('pulls US Reports citations', () => {
    expect(extractCitations('see 410 U.S. 113 (1973)')).toContain('410 U.S. 113');
  });
  it('pulls federal reporter citations', () => {
    expect(extractCitations('123 F.3d 456 and 5 Cal. 4th 200')).toEqual(
      expect.arrayContaining(['123 F.3d 456', '5 Cal. 4th 200']),
    );
  });
  it('ignores pure number runs with no reporter token', () => {
    expect(extractCitations('filed in 2023, decided 2024')).toEqual([]);
  });
  it('returns [] for empty input', () => {
    expect(extractCitations('')).toEqual([]);
    expect(extractCitations(null)).toEqual([]);
  });
});
