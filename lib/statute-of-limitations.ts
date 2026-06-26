/**
 * Statute of limitations by state and claim type. Drives the
 * interactive checker at /tools/statute-of-limitations.
 *
 * This is one of the highest-intent legal-search SERPs:
 *   "how long do i have to sue in [state]"
 *   "[state] statute of limitations personal injury"
 *   "[state] sol contract written"
 *
 * Marketing teams at PI firms pay $30-$120 cost-per-click for
 * these queries because the searcher is often days away from
 * losing their right to file. Owning this surface organically
 * is worth a lot.
 *
 * Sourcing notes:
 *   - Figures sourced from each state's controlling statute as
 *     of 2025-2026.
 *   - Where a state has a discovery rule (toll until the harm is
 *     discovered) we note it inline. Don't show a hard date as
 *     authoritative without that caveat.
 *   - Medical malpractice has a separate statute of repose in
 *     many states (an outer-edge limit regardless of discovery).
 *     Where that exists, the note flags it.
 *
 * NOT LEGAL ADVICE. The page closes with a "consult an attorney"
 * disclaimer; this dataset is informational only.
 */

export type ClaimTypeId =
  | 'personal-injury'
  | 'written-contract'
  | 'oral-contract'
  | 'property-damage'
  | 'fraud'
  | 'defamation'
  | 'medical-malpractice'
  | 'wrongful-death'
  | 'debt-collection';

export type ClaimType = {
  id: ClaimTypeId;
  label: string;
  /** Plain-English description shown under the picker. */
  description: string;
  /** Example queries this covers - drives FAQ schema. */
  examples: string[];
};

export const CLAIM_TYPES: ClaimType[] = [
  {
    id: 'personal-injury',
    label: 'Personal injury',
    description:
      'Injuries from car crashes, slip-and-fall, dog bites, defective products, assault, or any other case where someone caused you physical or emotional harm.',
    examples: [
      'I was hit by a car six months ago, can I still sue?',
      'How long do I have to file an injury claim?',
    ],
  },
  {
    id: 'written-contract',
    label: 'Breach of written contract',
    description:
      'A signed contract was broken. Includes leases, service agreements, settlement agreements, and most business deals memorialized in writing.',
    examples: [
      'A contractor signed a contract and never finished the job',
      'My business partner breached our written agreement',
    ],
  },
  {
    id: 'oral-contract',
    label: 'Breach of oral contract',
    description:
      'A verbal agreement was broken. Harder to prove than written contracts and almost always shorter time windows.',
    examples: [
      'We had a verbal deal and they walked away',
      'My handshake agreement was broken',
    ],
  },
  {
    id: 'property-damage',
    label: 'Property damage',
    description:
      'Someone damaged your real estate, vehicle, or other property. Covers vandalism, accidents, and trespass.',
    examples: [
      'A neighbor cut down trees on my property',
      'Someone crashed into my fence and won’t pay',
    ],
  },
  {
    id: 'fraud',
    label: 'Fraud',
    description:
      'Someone misled you on purpose and you lost money or property because of it. Most states pause the clock until you discovered the fraud (the “discovery rule”).',
    examples: [
      'A seller lied about a major defect',
      'A financial advisor stole from my account',
    ],
  },
  {
    id: 'defamation',
    label: 'Defamation (libel / slander)',
    description:
      'Someone made a false statement about you that damaged your reputation. Libel is written; slander is spoken. Time windows are unusually short.',
    examples: [
      'A coworker spread lies that got me fired',
      'A blog post defamed my business',
    ],
  },
  {
    id: 'medical-malpractice',
    label: 'Medical malpractice',
    description:
      'A doctor, hospital, or other healthcare provider injured you through negligence. Most states have both a regular statute of limitations and an outer-edge statute of repose.',
    examples: [
      'A surgeon left a sponge inside me',
      'My doctor missed a cancer diagnosis',
    ],
  },
  {
    id: 'wrongful-death',
    label: 'Wrongful death',
    description:
      'A family member died because of someone else’s negligence or intentional act. The clock usually starts at the date of death, not the date of the underlying incident.',
    examples: [
      'A family member died in a car accident',
      'A loved one died from medical malpractice',
    ],
  },
  {
    id: 'debt-collection',
    label: 'Debt collection (written)',
    description:
      'How long a creditor has to sue you on a written debt: credit card, personal loan, judgment renewal. Once the SOL runs, the debt becomes “time-barred” and the creditor cannot win a lawsuit, though they can still ask you to pay.',
    examples: [
      'Can a collector still sue me on this old credit card?',
      'How old does a debt have to be before it’s time-barred?',
    ],
  },
];

export type SolEntry = {
  /** Years from accrual. Use 0.5 for 6 months, etc. */
  years: number;
  /** Inline caveat displayed below the headline number. */
  note?: string;
};

export type StateSol = {
  /** Lowercase, hyphenated slug for the URL filter param. */
  slug: string;
  /** Display name. */
  name: string;
  /** Two-letter postal code. */
  abbr: string;
  /** Per-claim-type statute of limitations. */
  limits: Record<ClaimTypeId, SolEntry>;
};

/**
 * Compact constructor so each state line stays scannable. Order
 * of args matches CLAIM_TYPES.
 */
function state(
  slug: string,
  name: string,
  abbr: string,
  pi: SolEntry,
  wc: SolEntry,
  oc: SolEntry,
  pd: SolEntry,
  fr: SolEntry,
  df: SolEntry,
  mm: SolEntry,
  wd: SolEntry,
  dc: SolEntry,
): StateSol {
  return {
    slug,
    name,
    abbr,
    limits: {
      'personal-injury': pi,
      'written-contract': wc,
      'oral-contract': oc,
      'property-damage': pd,
      fraud: fr,
      defamation: df,
      'medical-malpractice': mm,
      'wrongful-death': wd,
      'debt-collection': dc,
    },
  };
}

const Y = (years: number, note?: string): SolEntry => ({ years, note });

export const STATES_SOL: StateSol[] = [
  state('alabama', 'Alabama', 'AL', Y(2), Y(6), Y(6), Y(6), Y(2, 'Discovery rule applies.'), Y(2), Y(2, '4-year statute of repose.'), Y(2), Y(6)),
  state('alaska', 'Alaska', 'AK', Y(2), Y(3), Y(3), Y(6), Y(3, 'Discovery rule applies.'), Y(2), Y(2, '10-year statute of repose.'), Y(2), Y(3)),
  state('arizona', 'Arizona', 'AZ', Y(2), Y(6), Y(3), Y(2), Y(3, 'Discovery rule applies.'), Y(1), Y(2), Y(2), Y(6)),
  state('arkansas', 'Arkansas', 'AR', Y(3), Y(5), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(1), Y(2, '2-year discovery cap.'), Y(3), Y(5)),
  state('california', 'California', 'CA', Y(2), Y(4), Y(2), Y(3), Y(3, 'Tolled until discovery.'), Y(1), Y(3, '1-year from discovery; 3-year outer limit.'), Y(2), Y(4)),
  state('colorado', 'Colorado', 'CO', Y(2, '3 years for motor vehicle accidents.'), Y(3), Y(3), Y(2), Y(3, 'Tolled until discovery.'), Y(1), Y(2, '3-year statute of repose.'), Y(2), Y(6)),
  state('connecticut', 'Connecticut', 'CT', Y(2), Y(6), Y(3), Y(2), Y(3, 'Discovery rule applies.'), Y(2), Y(2, '3-year statute of repose.'), Y(2), Y(6)),
  state('delaware', 'Delaware', 'DE', Y(2), Y(3), Y(3), Y(2), Y(3, 'Discovery rule applies.'), Y(2), Y(2, '3-year outer limit.'), Y(2), Y(3)),
  state('district-of-columbia', 'District of Columbia', 'DC', Y(3), Y(3), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(1), Y(3, 'Discovery rule applies.'), Y(2), Y(3)),
  state('florida', 'Florida', 'FL', Y(2, 'Reduced from 4 years in 2023.'), Y(5), Y(4), Y(4), Y(4, 'Tolled until discovery; 12-year outer limit.'), Y(2), Y(2, '4-year statute of repose.'), Y(2), Y(5)),
  state('georgia', 'Georgia', 'GA', Y(2), Y(6), Y(4), Y(4), Y(2, 'Discovery rule applies.'), Y(1), Y(2, '5-year statute of repose.'), Y(2), Y(6)),
  state('hawaii', 'Hawaii', 'HI', Y(2), Y(6), Y(6), Y(2), Y(6, 'Discovery rule applies.'), Y(2), Y(2, '6-year statute of repose.'), Y(2), Y(6)),
  state('idaho', 'Idaho', 'ID', Y(2), Y(5), Y(4), Y(3), Y(3, 'Tolled until discovery.'), Y(2), Y(2), Y(2), Y(5)),
  state('illinois', 'Illinois', 'IL', Y(2), Y(10), Y(5), Y(5), Y(5, 'Discovery rule applies.'), Y(1), Y(2, '4-year statute of repose.'), Y(2), Y(10)),
  state('indiana', 'Indiana', 'IN', Y(2), Y(10), Y(6), Y(2), Y(6, 'Discovery rule applies.'), Y(2), Y(2, '2-year discovery cap.'), Y(2), Y(6)),
  state('iowa', 'Iowa', 'IA', Y(2), Y(10), Y(5), Y(5), Y(5, 'Discovery rule applies.'), Y(2), Y(2, '6-year statute of repose.'), Y(2), Y(10)),
  state('kansas', 'Kansas', 'KS', Y(2), Y(5), Y(3), Y(2), Y(2, 'Discovery rule applies.'), Y(1), Y(2, '4-year statute of repose.'), Y(2), Y(5)),
  state('kentucky', 'Kentucky', 'KY', Y(1), Y(15), Y(5), Y(5), Y(5, 'Tolled until discovery.'), Y(1), Y(1, '5-year statute of repose.'), Y(1), Y(15)),
  state('louisiana', 'Louisiana', 'LA', Y(1), Y(10), Y(10), Y(1), Y(1, 'Discovery rule applies.'), Y(1), Y(1, '3-year statute of repose.'), Y(1), Y(10)),
  state('maine', 'Maine', 'ME', Y(6), Y(6), Y(6), Y(6), Y(6, 'Discovery rule applies.'), Y(2), Y(3, '3-year statute of repose.'), Y(2), Y(6)),
  state('maryland', 'Maryland', 'MD', Y(3), Y(3), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(1), Y(5, 'or 3 years from discovery.'), Y(3), Y(3)),
  state('massachusetts', 'Massachusetts', 'MA', Y(3), Y(6), Y(6), Y(3), Y(3, 'Discovery rule applies.'), Y(3), Y(3, '7-year statute of repose.'), Y(3), Y(6)),
  state('michigan', 'Michigan', 'MI', Y(3), Y(6), Y(6), Y(3), Y(6, 'Discovery rule applies.'), Y(1), Y(2, '6-year statute of repose.'), Y(3), Y(6)),
  state('minnesota', 'Minnesota', 'MN', Y(6), Y(6), Y(6), Y(6), Y(6, 'Discovery rule applies.'), Y(2), Y(4, 'Discovery rule applies.'), Y(3), Y(6)),
  state('mississippi', 'Mississippi', 'MS', Y(3), Y(3), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(1), Y(2, '7-year statute of repose.'), Y(3), Y(3)),
  state('missouri', 'Missouri', 'MO', Y(5), Y(10), Y(5), Y(5), Y(5, 'Discovery rule applies.'), Y(2), Y(2, '10-year statute of repose.'), Y(3), Y(10)),
  state('montana', 'Montana', 'MT', Y(3), Y(8), Y(5), Y(2), Y(2, 'Discovery rule applies.'), Y(2), Y(3, '5-year statute of repose.'), Y(3), Y(8)),
  state('nebraska', 'Nebraska', 'NE', Y(4), Y(5), Y(4), Y(4), Y(4, 'Discovery rule applies.'), Y(1), Y(2, '10-year statute of repose.'), Y(2), Y(5)),
  state('nevada', 'Nevada', 'NV', Y(2), Y(6), Y(4), Y(3), Y(3, 'Discovery rule applies.'), Y(2), Y(3, '4-year statute of repose.'), Y(2), Y(6)),
  state('new-hampshire', 'New Hampshire', 'NH', Y(3), Y(3), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(3), Y(2, '2-year discovery cap.'), Y(3), Y(3)),
  state('new-jersey', 'New Jersey', 'NJ', Y(2), Y(6), Y(6), Y(6), Y(6, 'Discovery rule applies.'), Y(1), Y(2, '13-year statute of repose for foreign objects.'), Y(2), Y(6)),
  state('new-mexico', 'New Mexico', 'NM', Y(3), Y(6), Y(4), Y(4), Y(4, 'Discovery rule applies.'), Y(3), Y(3, '3-year statute of repose.'), Y(3), Y(6)),
  state('new-york', 'New York', 'NY', Y(3), Y(6), Y(6), Y(3), Y(6, 'Tolled until discovery; 2-year cap.'), Y(1), Y(2.5, '2.5-year statute of repose.'), Y(2), Y(6)),
  state('north-carolina', 'North Carolina', 'NC', Y(3), Y(3), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(1), Y(3, '4-year statute of repose.'), Y(2), Y(3)),
  state('north-dakota', 'North Dakota', 'ND', Y(6), Y(6), Y(6), Y(6), Y(6, 'Discovery rule applies.'), Y(2), Y(2, '6-year statute of repose.'), Y(2), Y(6)),
  state('ohio', 'Ohio', 'OH', Y(2), Y(8), Y(6), Y(2), Y(4, 'Discovery rule applies.'), Y(1), Y(1, '4-year statute of repose.'), Y(2), Y(8)),
  state('oklahoma', 'Oklahoma', 'OK', Y(2), Y(5), Y(3), Y(2), Y(2, 'Discovery rule applies.'), Y(1), Y(2, '3-year statute of repose.'), Y(2), Y(5)),
  state('oregon', 'Oregon', 'OR', Y(2), Y(6), Y(6), Y(6), Y(2, 'Discovery rule applies.'), Y(1), Y(2, '5-year statute of repose.'), Y(3), Y(6)),
  state('pennsylvania', 'Pennsylvania', 'PA', Y(2), Y(4), Y(4), Y(2), Y(2, 'Discovery rule applies.'), Y(1), Y(2, '7-year statute of repose.'), Y(2), Y(4)),
  state('rhode-island', 'Rhode Island', 'RI', Y(3), Y(10), Y(10), Y(10), Y(10, 'Discovery rule applies.'), Y(3), Y(3, '3-year statute of repose.'), Y(3), Y(10)),
  state('south-carolina', 'South Carolina', 'SC', Y(3), Y(3), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(2), Y(3, '6-year statute of repose.'), Y(3), Y(3)),
  state('south-dakota', 'South Dakota', 'SD', Y(3), Y(6), Y(6), Y(6), Y(6, 'Discovery rule applies.'), Y(2), Y(2, '2-year statute of repose.'), Y(3), Y(6)),
  state('tennessee', 'Tennessee', 'TN', Y(1), Y(6), Y(6), Y(3), Y(3, 'Discovery rule applies.'), Y(0.5, 'Six months for slander.'), Y(1, '3-year statute of repose.'), Y(1), Y(6)),
  state('texas', 'Texas', 'TX', Y(2), Y(4), Y(4), Y(2), Y(4, 'Discovery rule applies.'), Y(1), Y(2, '10-year statute of repose.'), Y(2), Y(4)),
  state('utah', 'Utah', 'UT', Y(4), Y(6), Y(4), Y(3), Y(3, 'Discovery rule applies.'), Y(1), Y(2, '4-year statute of repose.'), Y(2), Y(6)),
  state('vermont', 'Vermont', 'VT', Y(3), Y(6), Y(6), Y(3), Y(6, 'Discovery rule applies.'), Y(3), Y(3, '7-year statute of repose.'), Y(2), Y(6)),
  state('virginia', 'Virginia', 'VA', Y(2), Y(5), Y(3), Y(5), Y(2, 'Discovery rule applies.'), Y(1), Y(2, '10-year statute of repose for foreign objects.'), Y(2), Y(5)),
  state('washington', 'Washington', 'WA', Y(3), Y(6), Y(3), Y(3), Y(3, 'Discovery rule applies.'), Y(2), Y(3, '8-year statute of repose.'), Y(3), Y(6)),
  state('west-virginia', 'West Virginia', 'WV', Y(2), Y(10), Y(5), Y(2), Y(2, 'Discovery rule applies.'), Y(1), Y(2, '10-year statute of repose.'), Y(2), Y(10)),
  state('wisconsin', 'Wisconsin', 'WI', Y(3), Y(6), Y(6), Y(6), Y(6, 'Discovery rule applies.'), Y(3), Y(3, '5-year statute of repose.'), Y(3), Y(6)),
  state('wyoming', 'Wyoming', 'WY', Y(4), Y(10), Y(8), Y(4), Y(4, 'Discovery rule applies.'), Y(1), Y(2, '2-year discovery cap.'), Y(2), Y(10)),
];

export function getState(slug: string): StateSol | null {
  return STATES_SOL.find((s) => s.slug === slug) ?? null;
}

export function getClaimType(id: string): ClaimType | null {
  return CLAIM_TYPES.find((c) => c.id === id) ?? null;
}

/**
 * Format the limit as plain English. 2 → "2 years", 0.5 →
 * "6 months", 2.5 → "2 years, 6 months".
 */
export function formatYears(years: number): string {
  if (years === 0.5) return '6 months';
  if (years < 1) {
    const months = Math.round(years * 12);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  if (Number.isInteger(years)) {
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  const wholeYears = Math.floor(years);
  const remainderMonths = Math.round((years - wholeYears) * 12);
  return `${wholeYears} year${wholeYears === 1 ? '' : 's'}, ${remainderMonths} months`;
}
