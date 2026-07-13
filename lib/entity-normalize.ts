/**
 * Canonicalize an extracted organization name for the "persons & organizations
 * of interest" list: drop non-party platforms/services, and merge the many
 * surface forms of the same entity into one canonical label.
 *
 * Returns the canonical display name, or null when the org is noise that should
 * not appear (payment rails, social platforms, unrelated third parties).
 */

// Substring match (on the lowercased name) -> canonical display name. First
// match wins, so order the specific ones before generic ones.
const CANONICAL: { match: RegExp; name: string }[] = [
  { match: /re\s*\+?\s*gen/, name: 'RE+GEN Nutrition' },
  { match: /\bzinpro\b/, name: 'Zinpro Corporation' },
  { match: /c\s*&?\s*s\s+nutrition/, name: 'C&S Nutrition LLC' },
  { match: /peak\s+wellness/, name: 'Peak Wellness by Scott LLC' },
  { match: /shorewood\s+stump/, name: 'Shorewood Stump LLC' },
  { match: /custom\s+stacks/, name: 'Custom Stacks Nutrition' },
  { match: /modern\s+sports\s+nutrition/, name: 'Modern Sports Nutrition' },
  { match: /modern\s+aminos/, name: 'Modern Aminos' },
  { match: /360\s*cut/, name: '360CUT' },
  { match: /impact\s+labs/, name: 'Impact Labs' },
  { match: /elemend/, name: 'Elemend Health' },
  { match: /mend\s*\+?\s*defend/, name: 'Mend + Defend' },
];

// Non-party platforms, payment rails, retailers, and unrelated third parties
// that should never appear as an "organization of interest". Matched as whole
// words / known names on the lowercased string.
const DENY: RegExp[] = [
  /^facebook$|^meta$/,
  /^instagram$/,
  /^amazon(\.com)?( inc\.?)?$/,
  /^shop\s?pay$/,
  /^bemidji state university$/,
  /^sap concur$|^concur$/,
  /^linkedin$/,
  /^x$|^x\.com$|^twitter$/,
  /^pinterest$/,
  /^youtube$/,
  /^tiktok$/,
  /^reddit$/,
  /^whatsapp$/,
  /^google( llc)?$/,
  /^safari$/,
  /^apple( inc\.?)?$/,
  /^microsoft$|^outlook$|^gmail$/,
  /^paypal$|^venmo$|^zelle$|^stripe$|^shopify$/,
  /^fedex$|^ups$|^usps$/,
  /^truthfinder$/,
];

export function canonicalOrg(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length < 2) return null;
  const lower = name.toLowerCase();
  if (DENY.some((re) => re.test(lower))) return null;
  for (const c of CANONICAL) if (c.match.test(lower)) return c.name;
  return name;
}
