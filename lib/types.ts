export type SubjectType = 'person' | 'business' | 'matter';

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

export type Case = {
  id: string;
  title: string;
  subjectName: string;
  subjectType: SubjectType;
  jurisdiction: Jurisdiction;
  caseType: CaseType;
  description: string;
  status: CaseStatus;
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
  uploadedAt: string;
};

export type ExhibitPlanItem = {
  id: string;
  caseId: string;
  label: string;
  title: string;
  description: string;
  position: number;
  filledByExhibitId?: string | null;
  createdAt: string;
};

export type Profile = {
  id: string;
  displayName?: string | null;
  role?: string | null;
  organization?: string | null;
  avatarUrl?: string | null;
  isAdmin: boolean;
  updatedAt: string;
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
