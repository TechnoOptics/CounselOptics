/**
 * Pre-populated dropdown of contract types for the consumer +
 * firm contracts repository. Users can pick from this list or
 * type a custom value (saved on the row's custom_type column).
 *
 * Categories are intentionally broad - the contract type is mostly
 * for filtering + Bella's review prompt; legal taxonomy is loose
 * because real-world contracts often span categories.
 */

export type ContractType = {
  id: string;
  label: string;
  group:
    | 'business'
    | 'employment'
    | 'real_estate'
    | 'consumer'
    | 'family_estate'
    | 'ip_tech'
    | 'transactional'
    | 'litigation'
    | 'misc';
  /** Short hint Bella uses when tailoring her review questions. */
  hint?: string;
};

export const CONTRACT_TYPES: ContractType[] = [
  // Business
  { id: 'nda', label: 'NDA / Non-disclosure', group: 'business' },
  { id: 'msa', label: 'Master Services Agreement (MSA)', group: 'business' },
  { id: 'sow', label: 'Statement of Work (SOW)', group: 'business' },
  { id: 'service_agreement', label: 'Service Agreement', group: 'business' },
  { id: 'consulting', label: 'Consulting Agreement', group: 'business' },
  { id: 'partnership', label: 'Partnership Agreement', group: 'business' },
  { id: 'operating_agreement', label: 'LLC Operating Agreement', group: 'business' },
  { id: 'shareholder_agreement', label: 'Shareholder Agreement', group: 'business' },
  { id: 'joint_venture', label: 'Joint Venture Agreement', group: 'business' },
  { id: 'distribution', label: 'Distribution / Reseller', group: 'business' },
  { id: 'franchise', label: 'Franchise Agreement', group: 'business' },
  { id: 'asset_purchase', label: 'Asset Purchase Agreement', group: 'business' },
  { id: 'stock_purchase', label: 'Stock Purchase Agreement', group: 'business' },
  { id: 'merger', label: 'Merger / M&A Agreement', group: 'business' },
  { id: 'loan', label: 'Loan / Promissory Note', group: 'business' },

  // Employment
  { id: 'employment_offer', label: 'Employment Offer Letter', group: 'employment' },
  { id: 'employment_contract', label: 'Employment Contract', group: 'employment' },
  { id: 'independent_contractor', label: 'Independent Contractor', group: 'employment' },
  { id: 'severance', label: 'Severance Agreement', group: 'employment' },
  { id: 'noncompete', label: 'Non-compete / Non-solicit', group: 'employment' },
  { id: 'equity_grant', label: 'Equity / Stock Option Grant', group: 'employment' },
  { id: 'bonus_plan', label: 'Bonus / Commission Plan', group: 'employment' },
  { id: 'employee_handbook', label: 'Employee Handbook Acknowledgement', group: 'employment' },

  // Real estate
  { id: 'lease_residential', label: 'Residential Lease', group: 'real_estate' },
  { id: 'lease_commercial', label: 'Commercial Lease', group: 'real_estate' },
  { id: 'rental_agreement', label: 'Rental / Sublease', group: 'real_estate' },
  { id: 'purchase_agreement', label: 'Real Estate Purchase Agreement', group: 'real_estate' },
  { id: 'mortgage', label: 'Mortgage / Deed of Trust', group: 'real_estate' },
  { id: 'easement', label: 'Easement / Right of Way', group: 'real_estate' },
  { id: 'hoa_agreement', label: 'HOA / CC&R Agreement', group: 'real_estate' },
  { id: 'property_management', label: 'Property Management', group: 'real_estate' },

  // Consumer + everyday
  { id: 'tos', label: 'Terms of Service / EULA', group: 'consumer' },
  { id: 'privacy_policy', label: 'Privacy Policy', group: 'consumer' },
  { id: 'subscription', label: 'Subscription Agreement', group: 'consumer' },
  { id: 'warranty', label: 'Warranty', group: 'consumer' },
  { id: 'gym_membership', label: 'Gym / Membership Agreement', group: 'consumer' },
  { id: 'auto_purchase', label: 'Auto Purchase / Lease', group: 'consumer' },
  { id: 'insurance_policy', label: 'Insurance Policy', group: 'consumer' },
  { id: 'cellphone', label: 'Phone / Cable Service', group: 'consumer' },

  // Family + estate
  { id: 'will', label: 'Last Will and Testament', group: 'family_estate' },
  { id: 'trust', label: 'Trust Document', group: 'family_estate' },
  { id: 'power_of_attorney', label: 'Power of Attorney', group: 'family_estate' },
  { id: 'living_will', label: 'Living Will / Advance Directive', group: 'family_estate' },
  { id: 'prenup', label: 'Prenuptial / Postnuptial', group: 'family_estate' },
  { id: 'divorce', label: 'Divorce Settlement', group: 'family_estate' },
  { id: 'custody', label: 'Custody / Parenting Plan', group: 'family_estate' },
  { id: 'adoption', label: 'Adoption Agreement', group: 'family_estate' },

  // IP / tech
  { id: 'license', label: 'License Agreement', group: 'ip_tech' },
  { id: 'sw_license', label: 'Software License (SaaS / on-prem)', group: 'ip_tech' },
  { id: 'ip_assignment', label: 'IP Assignment', group: 'ip_tech' },
  { id: 'trademark_license', label: 'Trademark License', group: 'ip_tech' },
  { id: 'data_processing', label: 'Data Processing Agreement (DPA)', group: 'ip_tech' },
  { id: 'baa', label: 'HIPAA Business Associate Agreement (BAA)', group: 'ip_tech' },

  // Transactional
  { id: 'bill_of_sale', label: 'Bill of Sale', group: 'transactional' },
  { id: 'purchase_order', label: 'Purchase Order / Sales Contract', group: 'transactional' },
  { id: 'supply_agreement', label: 'Supply Agreement', group: 'transactional' },
  { id: 'release', label: 'Liability Release / Waiver', group: 'transactional' },

  // Litigation / settlement
  { id: 'settlement', label: 'Settlement Agreement', group: 'litigation' },
  { id: 'engagement_letter', label: 'Engagement Letter', group: 'litigation' },
  { id: 'tolling_agreement', label: 'Tolling Agreement', group: 'litigation' },

  // Misc
  { id: 'other', label: 'Other (specify)', group: 'misc' },
];

export const CONTRACT_GROUPS: Record<ContractType['group'], string> = {
  business: 'Business',
  employment: 'Employment',
  real_estate: 'Real estate',
  consumer: 'Consumer',
  family_estate: 'Family + estate',
  ip_tech: 'IP + tech',
  transactional: 'Transactional',
  litigation: 'Litigation + settlement',
  misc: 'Other',
};

export function getContractType(id: string): ContractType | null {
  return CONTRACT_TYPES.find((t) => t.id === id) ?? null;
}

export const RECEIPT_CATEGORIES = [
  { id: 'payment', label: 'Payment receipt', hint: 'Wire, check, Stripe, Venmo, Zelle' },
  { id: 'screenshot', label: 'Screenshot or message', hint: 'Texts, emails, app screenshots' },
  { id: 'photo', label: 'Photo', hint: 'Damage, condition, evidence' },
  { id: 'voicemail', label: 'Voicemail / audio recording', hint: 'Recorded call, voice memo' },
  { id: 'email', label: 'Email thread', hint: 'PDF or screenshot of email' },
  { id: 'identity', label: 'Identity / record', hint: "ID copy, license, registration, transcript" },
  { id: 'medical', label: 'Medical record', hint: 'EOB, prescription, diagnosis report' },
  { id: 'tax', label: 'Tax / financial', hint: 'W-2, 1099, bank statement' },
  { id: 'work', label: 'Work product proof', hint: 'Timestamped deliverable, code commit' },
  { id: 'physical', label: 'Physical evidence', hint: 'Photographed object or document' },
  { id: 'other', label: 'Other', hint: '' },
] as const;

export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number]['id'];
