/**
 * Pure helpers + types for the deadline / statute-of-limitations
 * engine. No server-only imports here so client components can
 * pull in suggestSOL without dragging the admin client into the
 * bundle.
 *
 * Server-side bits (sweepDeadlineAlerts which writes notifications
 * via the admin client) live in lib/deadlines.ts.
 */

export type ClaimType =
  | 'personal_injury'
  | 'property_damage'
  | 'breach_of_written_contract'
  | 'breach_of_oral_contract'
  | 'fraud'
  | 'wrongful_death'
  | 'employment_discrimination'
  | 'wage_hour'
  | 'libel_slander'
  | 'product_liability'
  | 'medical_malpractice'
  | 'legal_malpractice'
  | 'real_property'
  | 'collection';

const SOL: Record<string, Partial<Record<ClaimType, number>>> = {
  default: {
    personal_injury: 2,
    property_damage: 2,
    breach_of_written_contract: 4,
    breach_of_oral_contract: 2,
    fraud: 3,
    wrongful_death: 2,
    employment_discrimination: 2,
    wage_hour: 2,
    libel_slander: 1,
    product_liability: 2,
    medical_malpractice: 2,
    legal_malpractice: 2,
    real_property: 5,
    collection: 4,
  },
  CA: {
    personal_injury: 2,
    property_damage: 3,
    breach_of_written_contract: 4,
    breach_of_oral_contract: 2,
    fraud: 3,
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 1,
    legal_malpractice: 1,
    product_liability: 2,
    collection: 4,
  },
  NY: {
    personal_injury: 3,
    property_damage: 3,
    breach_of_written_contract: 6,
    breach_of_oral_contract: 6,
    fraud: 6,
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 2.5,
    legal_malpractice: 3,
    product_liability: 3,
    collection: 6,
  },
  TX: {
    personal_injury: 2,
    property_damage: 2,
    breach_of_written_contract: 4,
    breach_of_oral_contract: 4,
    fraud: 4,
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 2,
    legal_malpractice: 2,
    product_liability: 2,
    collection: 4,
  },
  FL: {
    personal_injury: 2,
    property_damage: 4,
    breach_of_written_contract: 5,
    breach_of_oral_contract: 4,
    fraud: 4,
    wrongful_death: 2,
    libel_slander: 2,
    medical_malpractice: 2,
    legal_malpractice: 2,
    product_liability: 4,
    collection: 5,
  },
  IL: {
    personal_injury: 2,
    property_damage: 5,
    breach_of_written_contract: 10,
    breach_of_oral_contract: 5,
    fraud: 5,
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 2,
    legal_malpractice: 2,
    product_liability: 2,
    collection: 10,
  },
};

export type SuggestedDeadline = {
  dueAt: string;
  state: string;
  claimType: ClaimType;
  yearsFromAccrual: number;
  reminder: string;
};

export function suggestSOL(
  accrualDateISO: string,
  state: string,
  claimType: ClaimType,
): SuggestedDeadline | null {
  const stateNorm = state.toUpperCase().replace(/^US-/, '');
  const stateTable = SOL[stateNorm] ?? SOL.default;
  const years = stateTable[claimType] ?? SOL.default[claimType];
  if (years === undefined) return null;
  const accrual = new Date(accrualDateISO);
  if (Number.isNaN(accrual.getTime())) return null;
  const due = new Date(accrual);
  due.setFullYear(due.getFullYear() + Math.floor(years));
  const fractional = years - Math.floor(years);
  if (fractional > 0) {
    due.setMonth(due.getMonth() + Math.round(fractional * 12));
  }
  return {
    dueAt: due.toISOString(),
    state: stateNorm,
    claimType,
    yearsFromAccrual: years,
    reminder:
      'Suggested SOL deadline based on the general rule. Verify with counsel: tolling, discovery rule, repose, notice-of-claim periods, and minor / disability extensions can shift this materially.',
  };
}
