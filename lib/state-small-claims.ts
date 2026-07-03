/**
 * Small-claims court data by state. Drives the programmatic SEO
 * route at /resources/states/[state]/small-claims.
 *
 * Each entry should reflect the controlling statute and dollar
 * limit as of the reviewedAt date. These figures change - states
 * adjust limits via legislation every few years - so the
 * reviewedAt date matters and the page surfaces it.
 *
 * Sourcing notes:
 *   - Limits as of 2025-2026 sourced from each state's official
 *     judicial-branch website or self-help center.
 *   - Filing fees vary by claim amount in many states; the figure
 *     here is the typical mid-tier fee.
 *   - "Attorneys permitted" answers the most-asked SERP question
 *     ("can lawyers be in small claims court in [state]?").
 *
 * Verification cadence: re-check annually in January. Outdated
 * dollar limits hurt rankings and burn user trust.
 */

export type StateSmallClaims = {
  /** Lowercase, hyphenated slug for the URL. */
  slug: string;
  /** Display name. */
  name: string;
  /** Two-letter postal code. */
  abbr: string;
  /** Maximum dollar amount eligible for small claims. */
  monetaryLimit: number;
  /** Typical filing fee at the mid-tier claim amount. */
  filingFee: string;
  /** Court name in this state. */
  courtName: string;
  /** Controlling statute citation. */
  statute: string;
  /** Are attorneys permitted to represent parties? */
  attorneysAllowed: 'Yes' | 'No' | 'Limited';
  /** Notes on attorney representation - free-form. */
  attorneysNote: string;
  /** Window to file an appeal after judgment, in days. */
  appealWindowDays: number;
  /** Special notes, if any. */
  notes?: string;
};

export const STATES_SMALL_CLAIMS: StateSmallClaims[] = [
  { slug: 'alabama', name: 'Alabama', abbr: 'AL', monetaryLimit: 6000, filingFee: '$50-$95', courtName: 'Small Claims Division of District Court', statute: 'Ala. R. Civ. P. SCS-1', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent either party.', appealWindowDays: 14 },
  { slug: 'alaska', name: 'Alaska', abbr: 'AK', monetaryLimit: 10000, filingFee: '$50-$75', courtName: 'Small Claims Court', statute: 'AS 22.15.040', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may appear for either side.', appealWindowDays: 30 },
  { slug: 'arizona', name: 'Arizona', abbr: 'AZ', monetaryLimit: 3500, filingFee: '$26-$32', courtName: 'Justice Court (Small Claims Division)', statute: 'A.R.S. § 22-501', attorneysAllowed: 'No', attorneysNote: 'Attorneys are barred unless the other party agrees in writing.', appealWindowDays: 0, notes: 'No appeals from small claims in Arizona.' },
  { slug: 'arkansas', name: 'Arkansas', abbr: 'AR', monetaryLimit: 5000, filingFee: '$50-$80', courtName: 'Small Claims Division of District Court', statute: 'Ark. Code § 16-17-601', attorneysAllowed: 'No', attorneysNote: 'Attorneys generally not permitted.', appealWindowDays: 30 },
  { slug: 'california', name: 'California', abbr: 'CA', monetaryLimit: 12500, filingFee: '$30-$75', courtName: 'Small Claims Court (Superior Court)', statute: 'Cal. Code Civ. Proc. § 116.110', attorneysAllowed: 'No', attorneysNote: 'Attorneys may not represent parties at trial in small claims; may consult before and after.', appealWindowDays: 30, notes: 'Higher $6,500 cap if the plaintiff is a business; $12,500 for individuals. Only the defendant may appeal.' },
  { slug: 'colorado', name: 'Colorado', abbr: 'CO', monetaryLimit: 7500, filingFee: '$31-$55', courtName: 'Small Claims Court', statute: 'C.R.S. § 13-6-403', attorneysAllowed: 'Limited', attorneysNote: 'Attorneys allowed only if both parties consent.', appealWindowDays: 14 },
  { slug: 'connecticut', name: 'Connecticut', abbr: 'CT', monetaryLimit: 5000, filingFee: '$95', courtName: 'Small Claims Court', statute: 'Conn. Gen. Stat. § 51-15', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 0, notes: 'No appeals from small claims in Connecticut.' },
  { slug: 'delaware', name: 'Delaware', abbr: 'DE', monetaryLimit: 25000, filingFee: '$40-$100', courtName: 'Justice of the Peace Court', statute: '10 Del. C. § 9301', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 15 },
  { slug: 'florida', name: 'Florida', abbr: 'FL', monetaryLimit: 8000, filingFee: '$55-$300', courtName: 'County Court (Small Claims)', statute: 'Fla. R. Sm. Cl. P. 7.010', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties; many proceed without.', appealWindowDays: 30, notes: 'Pre-trial conference required in many counties.' },
  { slug: 'georgia', name: 'Georgia', abbr: 'GA', monetaryLimit: 15000, filingFee: '$50-$100', courtName: 'Magistrate Court', statute: 'O.C.G.A. § 15-10-2', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'hawaii', name: 'Hawaii', abbr: 'HI', monetaryLimit: 5000, filingFee: '$35-$70', courtName: 'Small Claims Division of District Court', statute: 'HRS § 633-27', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 0, notes: 'No appeals except for jurisdictional issues.' },
  { slug: 'idaho', name: 'Idaho', abbr: 'ID', monetaryLimit: 5000, filingFee: '$59', courtName: 'Small Claims Department of Magistrate Court', statute: 'Idaho Code § 1-2301', attorneysAllowed: 'No', attorneysNote: 'Attorneys may not represent parties unless they are the party.', appealWindowDays: 30 },
  { slug: 'illinois', name: 'Illinois', abbr: 'IL', monetaryLimit: 10000, filingFee: '$60-$170', courtName: 'Circuit Court (Small Claims)', statute: 'Ill. Sup. Ct. R. 281', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'indiana', name: 'Indiana', abbr: 'IN', monetaryLimit: 8000, filingFee: '$76-$87', courtName: 'Small Claims Court', statute: 'Ind. Code § 33-29-2-4', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'iowa', name: 'Iowa', abbr: 'IA', monetaryLimit: 6500, filingFee: '$95', courtName: 'Small Claims Court', statute: 'Iowa Code § 631.1', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 20 },
  { slug: 'kansas', name: 'Kansas', abbr: 'KS', monetaryLimit: 4000, filingFee: '$39-$78', courtName: 'Small Claims Court', statute: 'K.S.A. § 61-2702', attorneysAllowed: 'No', attorneysNote: 'Attorneys generally not permitted in small claims.', appealWindowDays: 14 },
  { slug: 'kentucky', name: 'Kentucky', abbr: 'KY', monetaryLimit: 2500, filingFee: '$60-$80', courtName: 'Small Claims Division of District Court', statute: 'KRS § 24A.230', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 10 },
  { slug: 'louisiana', name: 'Louisiana', abbr: 'LA', monetaryLimit: 5000, filingFee: '$80-$200', courtName: 'City Court (Small Claims)', statute: 'La. R.S. 13:5200', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 10 },
  { slug: 'maine', name: 'Maine', abbr: 'ME', monetaryLimit: 6000, filingFee: '$60', courtName: 'District Court (Small Claims)', statute: '14 M.R.S. § 7481', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'maryland', name: 'Maryland', abbr: 'MD', monetaryLimit: 5000, filingFee: '$36-$55', courtName: 'District Court (Small Claims)', statute: 'Md. Code, Cts. & Jud. Proc. § 4-405', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'massachusetts', name: 'Massachusetts', abbr: 'MA', monetaryLimit: 7000, filingFee: '$40-$150', courtName: 'Small Claims Session of District Court', statute: 'M.G.L. c. 218 § 21', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 10 },
  { slug: 'michigan', name: 'Michigan', abbr: 'MI', monetaryLimit: 7000, filingFee: '$30-$70', courtName: 'Small Claims Division of District Court', statute: 'MCL § 600.8401', attorneysAllowed: 'No', attorneysNote: 'Attorneys cannot represent parties in Michigan small claims.', appealWindowDays: 21, notes: 'Filing in small claims waives right to attorney representation and jury trial.' },
  { slug: 'minnesota', name: 'Minnesota', abbr: 'MN', monetaryLimit: 15000, filingFee: '$70-$80', courtName: 'Conciliation Court', statute: 'Minn. Stat. § 491A.01', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 20 },
  { slug: 'mississippi', name: 'Mississippi', abbr: 'MS', monetaryLimit: 3500, filingFee: '$50-$100', courtName: 'Justice Court', statute: 'Miss. Code § 9-11-9', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'missouri', name: 'Missouri', abbr: 'MO', monetaryLimit: 5000, filingFee: '$26-$58', courtName: 'Small Claims Court', statute: 'RSMo § 482.305', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 10 },
  { slug: 'montana', name: 'Montana', abbr: 'MT', monetaryLimit: 7000, filingFee: '$30-$50', courtName: 'Small Claims Court', statute: 'MCA § 25-35-501', attorneysAllowed: 'Limited', attorneysNote: 'Attorneys may not represent parties unless both parties have attorneys.', appealWindowDays: 10 },
  { slug: 'nebraska', name: 'Nebraska', abbr: 'NE', monetaryLimit: 3900, filingFee: '$25-$50', courtName: 'Small Claims Court', statute: 'Neb. Rev. Stat. § 25-2802', attorneysAllowed: 'No', attorneysNote: 'Attorneys may not represent parties.', appealWindowDays: 30, notes: 'Limit adjusts every 5 years for inflation.' },
  { slug: 'nevada', name: 'Nevada', abbr: 'NV', monetaryLimit: 10000, filingFee: '$25-$110', courtName: 'Justice Court (Small Claims)', statute: 'NRS § 73.010', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 5 },
  { slug: 'new-hampshire', name: 'New Hampshire', abbr: 'NH', monetaryLimit: 10000, filingFee: '$90-$145', courtName: 'Circuit Court (Small Claims)', statute: 'RSA 503:1', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'new-jersey', name: 'New Jersey', abbr: 'NJ', monetaryLimit: 5000, filingFee: '$15-$30', courtName: 'Special Civil Part (Small Claims Section)', statute: 'N.J.S.A. 2A:18-61.1', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 45 },
  { slug: 'new-mexico', name: 'New Mexico', abbr: 'NM', monetaryLimit: 10000, filingFee: '$77', courtName: 'Magistrate Court', statute: 'NMSA § 35-3-3', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 15 },
  { slug: 'new-york', name: 'New York', abbr: 'NY', monetaryLimit: 10000, filingFee: '$15-$20', courtName: 'Small Claims Court', statute: 'NY UCCA § 1801', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30, notes: 'NYC limit $10,000; town and village courts often $3,000.' },
  { slug: 'north-carolina', name: 'North Carolina', abbr: 'NC', monetaryLimit: 10000, filingFee: '$96', courtName: 'Small Claims Court', statute: 'N.C.G.S. § 7A-210', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 10 },
  { slug: 'north-dakota', name: 'North Dakota', abbr: 'ND', monetaryLimit: 15000, filingFee: '$25', courtName: 'Small Claims Court', statute: 'N.D.C.C. § 27-08.1', attorneysAllowed: 'No', attorneysNote: 'Attorneys generally not permitted.', appealWindowDays: 0, notes: 'No appeals from small claims judgments.' },
  { slug: 'ohio', name: 'Ohio', abbr: 'OH', monetaryLimit: 6000, filingFee: '$50-$100', courtName: 'Small Claims Division', statute: 'R.C. § 1925.02', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'oklahoma', name: 'Oklahoma', abbr: 'OK', monetaryLimit: 10000, filingFee: '$58-$135', courtName: 'Small Claims Court', statute: '12 O.S. § 1751', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'oregon', name: 'Oregon', abbr: 'OR', monetaryLimit: 10000, filingFee: '$50-$135', courtName: 'Small Claims Department of Circuit Court', statute: 'ORS § 46.405', attorneysAllowed: 'No', attorneysNote: 'Attorneys not permitted without court approval.', appealWindowDays: 30 },
  { slug: 'pennsylvania', name: 'Pennsylvania', abbr: 'PA', monetaryLimit: 12000, filingFee: '$60-$140', courtName: 'Magisterial District Court', statute: '42 Pa.C.S. § 1515', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'rhode-island', name: 'Rhode Island', abbr: 'RI', monetaryLimit: 5000, filingFee: '$55-$80', courtName: 'Small Claims Court', statute: 'R.I. Gen. Laws § 10-16-1', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 2, notes: 'Two-day appeal window is the shortest in the country.' },
  { slug: 'south-carolina', name: 'South Carolina', abbr: 'SC', monetaryLimit: 7500, filingFee: '$80', courtName: 'Magistrate Court', statute: 'S.C. Code § 22-3-10', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'south-dakota', name: 'South Dakota', abbr: 'SD', monetaryLimit: 12000, filingFee: '$30-$50', courtName: 'Small Claims Court', statute: 'SDCL § 15-39-45', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 0, notes: 'No appeals from small claims.' },
  { slug: 'tennessee', name: 'Tennessee', abbr: 'TN', monetaryLimit: 25000, filingFee: '$100-$200', courtName: 'General Sessions Court', statute: 'T.C.A. § 16-15-501', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 10, notes: 'Tied with Delaware for the highest small-claims limit in the country.' },
  { slug: 'texas', name: 'Texas', abbr: 'TX', monetaryLimit: 20000, filingFee: '$54-$103', courtName: 'Justice Court (Small Claims Docket)', statute: 'Tex. R. Civ. P. 500-507', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 21 },
  { slug: 'utah', name: 'Utah', abbr: 'UT', monetaryLimit: 15000, filingFee: '$60-$185', courtName: 'Small Claims Court', statute: 'Utah Code § 78A-8-102', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'vermont', name: 'Vermont', abbr: 'VT', monetaryLimit: 5000, filingFee: '$65-$90', courtName: 'Small Claims Court', statute: '12 V.S.A. § 5531', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
  { slug: 'virginia', name: 'Virginia', abbr: 'VA', monetaryLimit: 5000, filingFee: '$36-$80', courtName: 'General District Court (Small Claims Division)', statute: 'Va. Code § 16.1-122.1', attorneysAllowed: 'No', attorneysNote: 'Attorneys not permitted in small claims division.', appealWindowDays: 10 },
  { slug: 'washington', name: 'Washington', abbr: 'WA', monetaryLimit: 10000, filingFee: '$50', courtName: 'Small Claims Department of District Court', statute: 'RCW § 12.40.010', attorneysAllowed: 'No', attorneysNote: 'Attorneys not permitted without judicial approval.', appealWindowDays: 30 },
  { slug: 'west-virginia', name: 'West Virginia', abbr: 'WV', monetaryLimit: 10000, filingFee: '$60', courtName: 'Magistrate Court', statute: 'W. Va. Code § 50-2-1', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 20 },
  { slug: 'wisconsin', name: 'Wisconsin', abbr: 'WI', monetaryLimit: 10000, filingFee: '$22-$94', courtName: 'Small Claims Court', statute: 'Wis. Stat. § 799.01', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 45 },
  { slug: 'wyoming', name: 'Wyoming', abbr: 'WY', monetaryLimit: 6000, filingFee: '$10-$50', courtName: 'Small Claims Court (Circuit Court)', statute: 'Wyo. Stat. § 1-21-201', attorneysAllowed: 'Yes', attorneysNote: 'Attorneys may represent parties.', appealWindowDays: 30 },
];

/** Reviewed date for the entire dataset. Surface on every state page. */
export const SMALL_CLAIMS_REVIEWED_AT = '2026-05-11';

export function getStateSmallClaims(slug: string): StateSmallClaims | null {
  return STATES_SMALL_CLAIMS.find((s) => s.slug === slug) ?? null;
}

/** Lowest dollar figure in a fee range string like "$50-$95" or "$95". */
export function filingFeeFloor(fee: string): number {
  const match = fee.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

/**
 * Powers /resources/small-claims-rankings. Computed from the same
 * dataset as the per-state pages, so the rankings page and the
 * state pages can never drift out of sync.
 */
export function getSmallClaimsRankings() {
  const byLimitDesc = [...STATES_SMALL_CLAIMS].sort(
    (a, b) => b.monetaryLimit - a.monetaryLimit,
  );
  const byFeeAsc = [...STATES_SMALL_CLAIMS].sort(
    (a, b) => filingFeeFloor(a.filingFee) - filingFeeFloor(b.filingFee),
  );
  const highestLimit = byLimitDesc.slice(0, 10);
  const lowestLimit = [...byLimitDesc].reverse().slice(0, 10);
  const cheapestFiling = byFeeAsc.slice(0, 10);
  const priciestFiling = [...byFeeAsc].reverse().slice(0, 10);
  const noAttorneys = STATES_SMALL_CLAIMS.filter(
    (s) => s.attorneysAllowed === 'No',
  );
  const noAppeal = STATES_SMALL_CLAIMS.filter((s) => s.appealWindowDays === 0);
  const shortestAppealWindow = STATES_SMALL_CLAIMS.filter(
    (s) => s.appealWindowDays > 0,
  ).sort((a, b) => a.appealWindowDays - b.appealWindowDays);

  return {
    byLimitDesc,
    highestLimit,
    lowestLimit,
    cheapestFiling,
    priciestFiling,
    noAttorneys,
    noAppeal,
    shortestAppealWindow: shortestAppealWindow.slice(0, 5),
    nationalMedianLimit: median(STATES_SMALL_CLAIMS.map((s) => s.monetaryLimit)),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
