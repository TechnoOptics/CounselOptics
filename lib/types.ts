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
};

export type Case = {
  id: string;
  ownerId?: string;
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

export type CollaboratorRole = 'viewer' | 'editor' | 'attorney' | 'witness';

export const COLLABORATOR_ROLE_LABEL: Record<CollaboratorRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  attorney: 'Attorney',
  witness: 'Witness',
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
  updatedAt: string;
};

export type Tier = 'basic' | 'standard' | 'pro';

export const TIER_LABEL: Record<Tier, string> = {
  basic: 'Basic',
  standard: 'Standard',
  pro: 'Pro',
};

export type TierFeatures = {
  caseLimit: number | null; // null = unlimited
  aiReview: boolean;
  pdfExport: boolean;
  bella: boolean;
  collaborators: boolean;
  monthlyPriceUsd: number;
};

export const TIER_FEATURES: Record<Tier, TierFeatures> = {
  basic: {
    caseLimit: 1,
    aiReview: false,
    pdfExport: true,
    bella: false,
    collaborators: false,
    monthlyPriceUsd: 9,
  },
  standard: {
    caseLimit: 5,
    aiReview: true,
    pdfExport: true,
    bella: true,
    collaborators: false,
    monthlyPriceUsd: 19,
  },
  pro: {
    caseLimit: null,
    aiReview: true,
    pdfExport: true,
    bella: true,
    collaborators: true,
    monthlyPriceUsd: 50,
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
