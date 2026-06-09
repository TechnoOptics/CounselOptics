/**
 * State-by-state security deposit rules. Drives the calculator
 * at /tools/security-deposit-deduction-checker.
 *
 * Each row covers:
 *   - max deposit (months of rent the landlord may hold)
 *   - return window (days after lease end the landlord has to
 *     return the deposit or send an itemized statement)
 *   - whether interest must be paid on the deposit
 *   - whether the landlord must provide an itemized list of
 *     deductions to keep any portion
 *   - penalty when the landlord wrongfully withholds
 *
 * Sourcing: each state's controlling landlord-tenant code as
 * of 2025-2026. Re-review annually.
 *
 * NOT LEGAL ADVICE. Local ordinances (NYC, San Francisco,
 * Chicago, etc.) often impose stricter rules than the state
 * floor. Always cross-check with city / county code.
 */

export type DepositRule = {
  slug: string;
  name: string;
  abbr: string;
  /** Maximum months of rent the landlord may hold (null = no cap). */
  maxMonths: number | null;
  /** Days after move-out the landlord has to return or itemize. */
  returnDays: number;
  /** Must the deposit accrue interest for the tenant? */
  interestRequired: boolean;
  /** Must the landlord provide an itemized statement of deductions? */
  itemizedRequired: boolean;
  /** Penalty for wrongful withholding (free-form, plain English). */
  penalty: string;
  /** State-specific note (city overrides, escrow requirements, etc.). */
  note?: string;
};

export const DEPOSIT_RULES: DepositRule[] = [
  { slug: 'alabama', name: 'Alabama', abbr: 'AL', maxMonths: 1, returnDays: 60, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion.' },
  { slug: 'alaska', name: 'Alaska', abbr: 'AK', maxMonths: 2, returnDays: 14, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.' },
  { slug: 'arizona', name: 'Arizona', abbr: 'AZ', maxMonths: 1.5, returnDays: 14, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.' },
  { slug: 'arkansas', name: 'Arkansas', abbr: 'AR', maxMonths: 2, returnDays: 60, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus attorney fees.' },
  { slug: 'california', name: 'California', abbr: 'CA', maxMonths: 1, returnDays: 21, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the deposit if the withholding is in bad faith.', note: 'SF + LA require receipts for any deduction over $125.' },
  { slug: 'colorado', name: 'Colorado', abbr: 'CO', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Up to 3 times the wrongfully withheld portion plus attorney fees and costs.', note: 'Lease may extend the return window to 60 days.' },
  { slug: 'connecticut', name: 'Connecticut', abbr: 'CT', maxMonths: 2, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.', note: '1 month max if tenant is 62 or older.' },
  { slug: 'delaware', name: 'Delaware', abbr: 'DE', maxMonths: 1, returnDays: 20, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.' },
  { slug: 'district-of-columbia', name: 'District of Columbia', abbr: 'DC', maxMonths: 1, returnDays: 45, interestRequired: true, itemizedRequired: true, penalty: 'Up to 3 times the wrongfully withheld portion.' },
  { slug: 'florida', name: 'Florida', abbr: 'FL', maxMonths: null, returnDays: 15, interestRequired: false, itemizedRequired: true, penalty: 'Forfeiture of the right to deduct anything if the 30-day notice deadline is missed.', note: 'Landlord must give a separate written notice of claim within 30 days.' },
  { slug: 'georgia', name: 'Georgia', abbr: 'GA', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Up to 3 times the wrongfully withheld portion plus attorney fees.' },
  { slug: 'hawaii', name: 'Hawaii', abbr: 'HI', maxMonths: 1, returnDays: 14, interestRequired: false, itemizedRequired: true, penalty: 'Up to 3 times the wrongfully withheld portion.' },
  { slug: 'idaho', name: 'Idaho', abbr: 'ID', maxMonths: null, returnDays: 21, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus court costs.', note: 'Lease may extend the return window to 30 days.' },
  { slug: 'illinois', name: 'Illinois', abbr: 'IL', maxMonths: null, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Up to 2 times the deposit plus attorney fees on wrongful withholding (5+ unit buildings).', note: 'Chicago requires interest paid annually and has additional disclosures.' },
  { slug: 'indiana', name: 'Indiana', abbr: 'IN', maxMonths: null, returnDays: 45, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus attorney fees.' },
  { slug: 'iowa', name: 'Iowa', abbr: 'IA', maxMonths: 2, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover the wrongfully withheld portion plus $200 if the landlord acted in bad faith.' },
  { slug: 'kansas', name: 'Kansas', abbr: 'KS', maxMonths: 1, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Up to 1.5 times the wrongfully withheld portion.', note: 'Furnished units allow up to 1.5 months.' },
  { slug: 'kentucky', name: 'Kentucky', abbr: 'KY', maxMonths: null, returnDays: 60, interestRequired: false, itemizedRequired: true, penalty: 'Forfeiture of the right to withhold any amount if the 30-day demand is not honored.' },
  { slug: 'louisiana', name: 'Louisiana', abbr: 'LA', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus $300 or actual damages.' },
  { slug: 'maine', name: 'Maine', abbr: 'ME', maxMonths: 2, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus attorney fees.' },
  { slug: 'maryland', name: 'Maryland', abbr: 'MD', maxMonths: 2, returnDays: 45, interestRequired: true, itemizedRequired: true, penalty: 'Up to 3 times the deposit plus reasonable attorney fees.' },
  { slug: 'massachusetts', name: 'Massachusetts', abbr: 'MA', maxMonths: 1, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Up to 3 times the deposit plus 5% interest and attorney fees for serious violations.', note: 'Massachusetts has some of the strictest deposit rules in the country.' },
  { slug: 'michigan', name: 'Michigan', abbr: 'MI', maxMonths: 1.5, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus attorney fees.' },
  { slug: 'minnesota', name: 'Minnesota', abbr: 'MN', maxMonths: null, returnDays: 21, interestRequired: true, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus $500 if in bad faith.' },
  { slug: 'mississippi', name: 'Mississippi', abbr: 'MS', maxMonths: null, returnDays: 45, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover the wrongfully withheld portion.' },
  { slug: 'missouri', name: 'Missouri', abbr: 'MO', maxMonths: 2, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.' },
  { slug: 'montana', name: 'Montana', abbr: 'MT', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus reasonable attorney fees.' },
  { slug: 'nebraska', name: 'Nebraska', abbr: 'NE', maxMonths: 1, returnDays: 14, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion.', note: 'Up to 1.25 months if tenant has a pet.' },
  { slug: 'nevada', name: 'Nevada', abbr: 'NV', maxMonths: 3, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus actual damages.' },
  { slug: 'new-hampshire', name: 'New Hampshire', abbr: 'NH', maxMonths: 1, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Up to 2 times the deposit plus interest for wrongful withholding.' },
  { slug: 'new-jersey', name: 'New Jersey', abbr: 'NJ', maxMonths: 1.5, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus attorney fees.' },
  { slug: 'new-mexico', name: 'New Mexico', abbr: 'NM', maxMonths: 1, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Forfeiture of the right to deduct anything if the deadline is missed.', note: 'Up to 2 months allowed for leases of 1 year or longer.' },
  { slug: 'new-york', name: 'New York', abbr: 'NY', maxMonths: 1, returnDays: 14, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion in bad-faith cases.', note: 'NYC rent-stabilized buildings have separate escrow + interest rules.' },
  { slug: 'north-carolina', name: 'North Carolina', abbr: 'NC', maxMonths: 2, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus attorney fees.', note: 'Month-to-month leases capped at 1.5 months.' },
  { slug: 'north-dakota', name: 'North Dakota', abbr: 'ND', maxMonths: 1, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus interest.' },
  { slug: 'ohio', name: 'Ohio', abbr: 'OH', maxMonths: null, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus attorney fees.', note: 'Interest required only on deposits held more than 6 months and only on amounts over $50.' },
  { slug: 'oklahoma', name: 'Oklahoma', abbr: 'OK', maxMonths: null, returnDays: 45, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus reasonable attorney fees.' },
  { slug: 'oregon', name: 'Oregon', abbr: 'OR', maxMonths: null, returnDays: 31, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.' },
  { slug: 'pennsylvania', name: 'Pennsylvania', abbr: 'PA', maxMonths: 2, returnDays: 30, interestRequired: true, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.', note: 'After year 1, deposit cap drops to 1 month. Interest required for deposits held over 2 years.' },
  { slug: 'rhode-island', name: 'Rhode Island', abbr: 'RI', maxMonths: 1, returnDays: 20, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus attorney fees.' },
  { slug: 'south-carolina', name: 'South Carolina', abbr: 'SC', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Up to 3 times the wrongfully withheld portion plus reasonable attorney fees.' },
  { slug: 'south-dakota', name: 'South Dakota', abbr: 'SD', maxMonths: 1, returnDays: 14, interestRequired: false, itemizedRequired: true, penalty: 'Up to $200 plus actual damages.', note: 'Itemized statement must be sent within 45 days if any portion is withheld.' },
  { slug: 'tennessee', name: 'Tennessee', abbr: 'TN', maxMonths: null, returnDays: 60, interestRequired: false, itemizedRequired: true, penalty: 'Forfeiture of the right to deduct if the landlord fails to give written notice within 60 days.' },
  { slug: 'texas', name: 'Texas', abbr: 'TX', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Up to 3 times the wrongfully withheld portion plus $100 and reasonable attorney fees.' },
  { slug: 'utah', name: 'Utah', abbr: 'UT', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus court costs.' },
  { slug: 'vermont', name: 'Vermont', abbr: 'VT', maxMonths: null, returnDays: 14, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion.', note: 'Burlington and other cities have stricter rules.' },
  { slug: 'virginia', name: 'Virginia', abbr: 'VA', maxMonths: 2, returnDays: 45, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus reasonable attorney fees.' },
  { slug: 'washington', name: 'Washington', abbr: 'WA', maxMonths: null, returnDays: 21, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus court costs and attorney fees.' },
  { slug: 'west-virginia', name: 'West Virginia', abbr: 'WV', maxMonths: null, returnDays: 60, interestRequired: false, itemizedRequired: true, penalty: 'Up to 1.5 times the wrongfully withheld portion plus damages.' },
  { slug: 'wisconsin', name: 'Wisconsin', abbr: 'WI', maxMonths: null, returnDays: 21, interestRequired: false, itemizedRequired: true, penalty: 'Up to 2 times the wrongfully withheld portion plus reasonable attorney fees.' },
  { slug: 'wyoming', name: 'Wyoming', abbr: 'WY', maxMonths: null, returnDays: 30, interestRequired: false, itemizedRequired: true, penalty: 'Tenant may recover wrongfully withheld portion plus civil penalty.', note: 'Return window extends to 60 days if landlord proves damage requires assessment.' },
];

export function getDepositRule(slug: string): DepositRule | null {
  return DEPOSIT_RULES.find((s) => s.slug === slug) ?? null;
}
