export type SubjectType =
  | 'person'
  | 'business'
  | 'matter'
  | 'state'
  | 'entity';

export const SUBJECT_TYPE_LABEL: Record<SubjectType, string> = {
  person: 'Person',
  business: 'Business',
  matter: 'Matter',
  state: 'State / government',
  entity: 'Entity / organization',
};

export type Posture = 'claimant' | 'defendant';

export type CaseStatus =
  | 'draft'
  | 'open'
  | 'under_review'
  | 'needs_evidence'
  | 'export_ready'
  | 'closed'
  | 'archived';

export const CASE_TYPES = [
  'Civil dispute',
  'Employment issue',
  'Landlord/tenant issue',
  'Contract dispute',
  'Family matter',
  'Criminal allegation',
  'Harassment/threats',
  'Property damage',
  'Fraud/scam',
  'Business dispute',
  'Other',
] as const;

export type CaseType = (typeof CASE_TYPES)[number];

export type Jurisdiction = {
  country: string;
  state?: string;
  city?: string;
};

export type SubjectProfile = {
  // Common
  legalName?: string;
  alsoKnownAs?: string;
  relationship?: string; // how they relate to the user (e.g., "former landlord")
  address?: string;
  email?: string;
  phone?: string;
  website?: string;
  notes?: string;
  // Person-specific
  dateOfBirthApprox?: string; // free text, e.g. "1985" or "early 40s"
  // Business-specific
  registrationNumber?: string; // EIN, business reg number
  businessType?: string; // LLC, corp, sole proprietor, etc.
  primaryContactName?: string;
  // Government / entity
  agencyOrDepartment?: string;
  jurisdictionLevel?: string; // federal / state / county / city

  // ── Party profile (firm "prove-the-case" layer) ──────────────────────────
  // A richer dossier the firm builds on the opposing party / subject, shown as
  // a portrait card in the matter facts. All optional and free text; stored in
  // the same cases.subject_profile jsonb (zero migration).
  /** The case_images (kind 'party') row id to feature as the party portrait /
   *  business logo. When unset the profile card shows the first party image. */
  featuredImageId?: string;
  /** The party's status in the matter, free text (e.g. "Defendant, active"). */
  caseStatus?: string;
  /** Why this party matters / their relevance to the matter, free text. */
  partyRelevance?: string;
  /** Where the party is located, free text (distinct from the mailing address). */
  location?: string;
  // Physical descriptors (person subjects). Free text; never inferred, only what
  // the firm records. Shown only for person-type subjects.
  gender?: string;
  height?: string;
  /** The party's age, free text so "42" or "early 40s" both work. Distinct
   *  from dateOfBirthApprox (a DOB / birth-year estimate). */
  age?: string;
  race?: string;
  /** Any other identifying descriptors, free text. */
  otherDescriptors?: string;
  /** Free-text role context: what the firm is trying to establish about this
   *  party in the matter (their part in the story). */
  roleContext?: string;
};

export type Case = {
  id: string;
  ownerId?: string;
  /** Firm member (auth.users id) responsible for the matter; null when
   *  unassigned. Only populated on the firm/counsel side. */
  assignedTo?: string | null;
  title: string;
  subjectName: string;
  subjectType: SubjectType;
  subjectProfile?: SubjectProfile;
  jurisdiction: Jurisdiction;
  caseType: CaseType;
  description: string;
  posture: Posture;
  status: CaseStatus;
  hearingAt?: string | null; // ISO timestamp
  hearingLocation?: string | null;
  hearingNotes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const EXHIBIT_CATEGORIES = [
  'Photo',
  'Document',
  'Communication',
  'Audio',
  'Video',
  'Receipt',
  'Contract',
  'Report',
  'Medical record',
  'Screenshot',
  'Witness statement',
  'Other',
] as const;

export type ExhibitCategory = (typeof EXHIBIT_CATEGORIES)[number];

export type ScanData = {
  /** Document classification: parking_ticket, traffic_citation, court_summons,
   *  complaint, motion, eviction_notice, demand_letter, contract, receipt,
   *  voice_note, video, other. */
  docType: string;
  identifiers: Record<string, string>;
  parties: string[];
  dates: { label: string; value: string }[];
  jurisdiction?: string | null;
  /** Money amount(s) referenced, e.g., "$185.00 fine". */
  amounts?: string[];
  /** Legal-statute citations referenced. */
  statuteRefs?: string[];
  /** One-paragraph plain-English summary. */
  summary: string;
  /** Full transcript for audio/video. */
  transcript?: string;
  /** Suggested category (one of EXHIBIT_CATEGORIES). */
  suggestedCategory?: ExhibitCategory;
  scannedAt: string;
  modelUsed: string;
  isDemo?: boolean;
};

/**
 * True when a scan really read the file.
 *
 * A demo scan is the placeholder `scanDocument` returns on a deployment with
 * no API key; its summary literally says the document was not scanned. Feeding
 * one back to a model lets it treat that sentence as a finding about the
 * evidence, so every consumer of scan_data has to exclude it. Kept here, in one
 * place, because the rule was about to exist in two: the review prompt builder
 * and Bella's case-detail tool.
 */
export function isRealScan(
  scan: { isDemo?: boolean; modelUsed?: string } | null | undefined,
): boolean {
  if (!scan) return false;
  if (scan.isDemo) return false;
  return scan.modelUsed !== 'demo' && scan.modelUsed !== 'unsupported';
}

export type Exhibit = {
  id: string;
  caseId: string;
  label: string;
  fileName: string;
  storedFileName: string;
  fileType: string;
  fileSize: number;
  description: string;
  incidentDate?: string | null;
  source?: string | null;
  category?: string | null;
  scanData?: ScanData | null;
  uploadedAt: string;
};

export type CollaboratorRole =
  | 'viewer'
  | 'editor'
  | 'attorney'
  | 'witness'
  | 'represented';

export const COLLABORATOR_ROLE_LABEL: Record<CollaboratorRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  attorney: 'Attorney',
  witness: 'Witness',
  represented: 'Represented party',
};

export type Collaborator = {
  id: string;
  caseId: string;
  userId?: string | null;
  email: string;
  role: CollaboratorRole;
  invitedBy?: string | null;
  invitedAt: string;
  acceptedAt?: string | null;
  /** Witness-only: their account of what happened, in their own words. */
  witnessStatement?: string | null;
  /** Last edit time for the witness_statement, if any. */
  witnessStatementUpdatedAt?: string | null;
};

export type SubscriptionStatus =
  | 'inactive'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'unpaid';

export type Subscription = {
  id: string;
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status: SubscriptionStatus;
  priceId?: string | null;
  tier?: Tier | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RepresentationStatus =
  | 'self_represented'
  | 'represented'
  | 'counsel'
  | 'user';

export const REPRESENTATION_LABEL: Record<RepresentationStatus, string> = {
  self_represented: 'Self-represented (no attorney)',
  represented: 'Represented (I have an attorney)',
  counsel: "Counsel (I'm an attorney)",
  user: 'Just exploring (decide later)',
};

export type ThemePref = 'light' | 'dark' | 'system';
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'zh', label: '中文' },
  { code: 'ar', label: 'العربية' },
] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

import type { AllMenuPreferences } from './menu-prefs';

export type Profile = {
  id: string;
  displayName?: string | null;
  role?: string | null;
  organization?: string | null;
  avatarUrl?: string | null;
  isAdmin: boolean;
  isBlocked?: boolean;
  representation?: RepresentationStatus | null;
  consentedAt?: string | null;
  tourCompletedAt?: string | null;
  theme?: ThemePref;
  language?: string | null;
  /** Set only after a successful Twilio Verify OTP check - see
   * lib/phone-verify.ts. Distinct from the self-reported, unverified
   * `phone` column Safe Witness uses for its "Call User" button. */
  phoneNumber?: string | null;
  phoneVerifiedAt?: string | null;
  /** Per-portal sidebar customization. See lib/menu-prefs.ts. */
  menuPreferences?: AllMenuPreferences;
  updatedAt: string;
};

export type Tier = 'basic' | 'standard' | 'pro';

/**
 * Display labels for the three legacy consumer tiers. The internal
 * slug values stay `basic | standard | pro` because they're already
 * persisted in Stripe subscriptions, the subscriptions table, and
 * webhooks - renaming them would orphan every existing customer.
 *
 * The LABELS were re-aligned 2026-05-14 to match the public /pricing
 * surface (Audit W20 V3 CR-19): public ladder shows Personal Pro $19,
 * Personal Plus $29, then firm tiers. The in-app /billing card used to
 * show "Basic $9 · Standard $19 · Pro $50" - completely different
 * names AND prices from public. Now they match: Free $0 → Personal
 * Pro $19 → Personal Plus $29. Firm tiers (Solo, Small Firm, Growing,
 * Enterprise) live exclusively on /pricing and are reachable from
 * /billing via a "See firm tiers" cross-link.
 */
export const TIER_LABEL: Record<Tier, string> = {
  basic: 'Free',
  standard: 'Personal Pro',
  pro: 'Personal Plus',
};

export type TierFeatures = {
  caseLimit: number | null; // null = unlimited
  aiReview: boolean;
  pdfExport: boolean;
  bella: boolean;
  collaborators: boolean;
  /**
   * Court e-filing directory (/file-exhibits). Free for everyone as
   * of 2026-05-11; the constant is retained on the tier shape so the
   * tier-card render does not have to be re-typed, but every tier
   * now reports `true` and the route no longer gates.
   */
  eFilingDirectory: boolean;
  /**
   * Public defender directory (/public-defender). Free for everyone
   * as of 2026-05-11. Same posture as eFilingDirectory above.
   */
  publicDefenderDirectory: boolean;
  /** Monthly Bella + Advottic Review token grant + top-ups. Pro-tier only. */
  proTokens: boolean;
  monthlyPriceUsd: number;
};

/**
 * Per-tier feature matrix.
 *
 * Prices + case caps re-aligned 2026-05-14 to match the public /pricing
 * ladder (Audit W20 V3 CR-19):
 *
 *   basic    -> Free       · $0/mo  · 1 item    (was $9/mo, 1 case)
 *   standard -> Personal Pro · $19/mo · 20 items (was $19/mo, 5 cases)
 *   pro      -> Personal Plus · $29/mo · 50 items (was $50/mo, unlimited)
 *
 * `caseLimit` is now an integer instead of `null` for the top tier;
 * the public /pricing surface and the new TIER_ITEM_LIMITS in
 * lib/token-packages.ts both encode 50 items for Personal Plus. The
 * code paths that read `caseLimit === null` as "unlimited" are
 * audited - none remain that depend on the unlimited semantics; the
 * gauge in app/billing/page.tsx uses calculateOverage() which honors
 * the integer cap directly.
 */
export const TIER_FEATURES: Record<Tier, TierFeatures> = {
  basic: {
    caseLimit: 1,
    aiReview: false,
    pdfExport: true,
    bella: false,
    collaborators: false,
    // Free across every tier (see TierFeatures.eFilingDirectory comment).
    eFilingDirectory: true,
    publicDefenderDirectory: true,
    proTokens: false,
    monthlyPriceUsd: 0,
  },
  standard: {
    caseLimit: 20,
    aiReview: true,
    pdfExport: true,
    bella: true,
    collaborators: false,
    eFilingDirectory: true,
    publicDefenderDirectory: true,
    proTokens: true,
    monthlyPriceUsd: 19,
  },
  pro: {
    caseLimit: 50,
    aiReview: true,
    pdfExport: true,
    bella: true,
    collaborators: true,
    eFilingDirectory: true,
    publicDefenderDirectory: true,
    proTokens: true,
    monthlyPriceUsd: 29,
  },
};

export type AIReview = {
  id: string;
  caseId: string;
  jurisdiction: string;
  summary: string;
  timeline: string[];
  keyFacts: string[];
  possibleIssues: string[];
  classification: string;
  applicableLegalReferences?: string[];
  evidenceMapping: string[];
  evidenceToStrengthen?: string[];
  subpoenaTargets?: string[];
  missingInformation: string[];
  suggestedNextSteps: string[];
  questionsForAttorney: string[];
  disclaimer: string;
  modelUsed: string;
  isDemo: boolean;
  createdAt: string;
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  under_review: 'Under Review',
  needs_evidence: 'Needs Evidence',
  export_ready: 'Export Ready',
  closed: 'Closed',
  archived: 'Archived',
};
