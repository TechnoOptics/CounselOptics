/**
 * Network-free CourtListener matching helpers: case-name / citation
 * normalisation and the conservative match logic the verifier relies on.
 *
 * Kept separate from lib/courtlistener.ts (which is `server-only` and does the
 * network calls) so this logic can be unit-tested in a plain node environment.
 * These functions decide whether a candidate the model proposed is consistent
 * with a record CourtListener returned; they never invent a citation.
 */

export const COURTLISTENER_BASE = 'https://www.courtlistener.com';

/** Ensure a CourtListener path/absolute_url becomes a full https URL. */
export function absoluteUrl(pathOrUrl: string | null | undefined): string | null {
  const s = (pathOrUrl ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `${COURTLISTENER_BASE}${s.startsWith('/') ? '' : '/'}${s}`;
}

/**
 * Normalise a case name for comparison: drop procedural suffixes ("et al.",
 * "Inc."), punctuation, and case, then collapse spaces.
 */
export function normalizeCaseName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\b(et al\.?|et ux\.?|inc\.?|llc|l\.l\.c\.|corp\.?|co\.?|ltd\.?|n\.a\.?|plc)\b/g, ' ')
    .replace(/[.,;:'"()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a case name on the "v." separator into its two sides (parties). */
export function partiesOf(name: string): [string, string] | null {
  const parts = normalizeCaseName(name).split(/\s+v\.?\s+|\s+vs\.?\s+/);
  if (parts.length < 2) return null;
  return [parts[0].trim(), parts.slice(1).join(' v ').trim()];
}

/**
 * Do two case names plausibly refer to the same case? Party names in the wild
 * differ in fullness ("Roe v. Wade" vs "Jane Roe, et al. v. Henry Wade"), so we
 * match when each side of one name shares a significant token with the same
 * side of the other. Conservative by design: used only to CONFIRM a candidate
 * against a real record, never to invent one.
 */
export function caseNamesMatch(a: string, b: string): boolean {
  const na = normalizeCaseName(a);
  const nb = normalizeCaseName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const pa = partiesOf(a);
  const pb = partiesOf(b);
  if (pa && pb) {
    const sideShares = (x: string, y: string) => {
      const tx = x.split(' ').filter((t) => t.length >= 3);
      const ty = y.split(' ').filter((t) => t.length >= 3);
      return tx.some((t) => ty.includes(t));
    };
    return sideShares(pa[0], pb[0]) && sideShares(pa[1], pb[1]);
  }
  // No "v." on one side (in re / ex parte / statute-style): require one to
  // contain the other's significant token run.
  return na.includes(nb) || nb.includes(na);
}

/**
 * Extract reporter-style citations ("410 U.S. 113", "347 U. S. 483",
 * "123 F.3d 456", "5 Cal. 4th 200") from free text. Best-effort; used to pull
 * a checkable citation out of a model's proposed string.
 */
export function extractCitations(text: string | null | undefined): string[] {
  const s = (text ?? '').trim();
  if (!s) return [];
  const re = /\b\d{1,4}\s+[A-Z][A-Za-z.]*(?:\s*\d?[A-Za-z.]+)*\.?\s*(?:\d[a-z]{0,2}\s+)?\d{1,5}\b/g;
  const out = new Set<string>();
  for (const m of s.match(re) ?? []) {
    const c = m.replace(/\s+/g, ' ').trim();
    // A real reporter citation always has an alphabetic reporter token, so
    // this drops pure number runs ("in 2023 2024").
    if (/[A-Za-z]/.test(c)) out.add(c);
  }
  return [...out];
}
