/**
 * Type surface for the law-firm perspective ("Advottic Counsel").
 * Server boundary returns these shapes; everything inside firm-mode
 * routes consumes them.
 *
 * See docs/LAW_FIRM_MODE.md for the architecture overview.
 */

// ---------------------------------------------------------------------------
// Firm type
// ---------------------------------------------------------------------------

export type FirmType =
  | 'individual'
  | 'firm'
  | 'corporate'
  | 'government'
  | 'legal_aid'
  | 'other';

export const FIRM_TYPES: FirmType[] = [
  'individual',
  'firm',
  'corporate',
  'government',
  'legal_aid',
  'other',
];

export const FIRM_TYPE_LABEL: Record<FirmType, string> = {
  individual: 'Individual counsel',
  firm: 'Law firm',
  corporate: 'Corporate / in-house counsel',
  government: 'Government / state',
  legal_aid: 'Legal aid / nonprofit',
  other: 'Other',
};

export const FIRM_TYPE_DESCRIPTION: Record<FirmType, string> = {
  individual:
    'A solo attorney or independent practitioner. You handle your own caseload and may bring in part-time staff.',
  firm: 'A traditional law firm with multiple attorneys, partners, and support staff working under a shared brand.',
  corporate:
    'An in-house legal team inside a company. Your client is the company itself - contracts, compliance, M&A, employment, regulatory.',
  government:
    'A government legal department - attorney general office, public defender, county counsel, agency legal team.',
  legal_aid:
    'A nonprofit, legal-aid clinic, or pro-bono organization that serves a population that cannot afford private counsel.',
  other:
    "Doesn't fit the above. Tell us what you do and we'll tailor the workspace to it.",
};

/** Free-form metadata captured during onboarding, conditional on
 *  firm type. The shape is intentionally loose so we can ask new
 *  questions without database migrations. Documented union types:
 *
 *  individual: { barNumber?: string; yearAdmitted?: number }
 *  firm:       { sizeBand?: '1-5'|'6-25'|'26-100'|'100+'; foundedYear?: number }
 *  corporate:  { parentCompany?: string; industry?: string; isGeneralCounsel?: boolean; businessAreas?: string[] }
 *  government: { agencyType?: string; governmentLevel?: 'federal'|'state'|'county'|'municipal'; caseFocus?: string[] }
 *  legal_aid:  { populationServed?: string; fundingSource?: string }
 *  other:      { description?: string }
 */
export type FirmMetadata = Record<string, unknown>;

export type FirmRole = 'owner' | 'admin' | 'attorney' | 'paralegal' | 'staff';

export const FIRM_ROLES: FirmRole[] = [
  'owner',
  'admin',
  'attorney',
  'paralegal',
  'staff',
];

export const FIRM_ROLE_LABEL: Record<FirmRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  attorney: 'Attorney',
  paralegal: 'Paralegal',
  staff: 'Staff',
};

export const FIRM_ROLE_DESCRIPTION: Record<FirmRole, string> = {
  owner:
    'Full control. Can change firm settings, billing, transfer ownership, and remove anyone.',
  admin:
    'Manage members, clients, channels, and documents. Cannot transfer ownership or close the firm.',
  attorney:
    'Read and edit cases, sign documents, message clients. Can invite clients.',
  paralegal:
    'Read and edit cases and documents. Can prepare signing requests but not send them.',
  staff:
    'Read-only access to non-privileged surfaces. Useful for receptionists or billing staff.',
};

export type Firm = {
  id: string;
  slug: string;
  name: string;
  firmType: FirmType;
  metadata: FirmMetadata;
  logoUrl: string | null;
  accentColor: string;
  jurisdictions: string[];
  practiceAreas: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FirmMember = {
  id: string;
  firmId: string;
  userId: string;
  role: FirmRole;
  displayName: string | null;
  email: string | null;
  joinedAt: string;
};

export type FirmInvitation = {
  id: string;
  firmId: string;
  email: string;
  role: FirmRole;
  invitedBy: string | null;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type FirmClientStatus = 'invited' | 'active' | 'archived';

export type FirmClient = {
  id: string;
  firmId: string;
  userId: string;
  primaryAttorneyId: string | null;
  invitedBy: string | null;
  status: FirmClientStatus;
  joinedAt: string;
  /** Hydrated from auth.users when listed. */
  email?: string | null;
  /** Hydrated from profiles when listed. */
  displayName?: string | null;
};

// ---------- Documents + signing ----------

export type FirmDocument = {
  id: string;
  firmId: string;
  name: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
  version: number;
  parentDocumentId: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  tags: string[];
  caseId: string | null;
  clientUserId: string | null;
  archivedAt: string | null;
};

export type FirmSigningStatus =
  | 'draft'
  | 'sent'
  | 'partial'
  | 'completed'
  | 'canceled';

export const FIRM_SIGNING_STATUS_LABEL: Record<FirmSigningStatus, string> = {
  draft: 'Draft',
  sent: 'Awaiting signatures',
  partial: 'Partially signed',
  completed: 'Completed',
  canceled: 'Canceled',
};

export type FirmSigningRequest = {
  id: string;
  firmId: string;
  documentId: string;
  requestedBy: string;
  status: FirmSigningStatus;
  message: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type FirmSignature = {
  id: string;
  signingRequestId: string;
  signerUserId: string | null;
  signerEmail: string;
  signerName: string | null;
  token: string;
  positionPage: number | null;
  positionX: number | null;
  positionY: number | null;
  signedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  signatureImagePath: string | null;
  auditHash: string | null;
  createdAt: string;
};

// ---------- Chat ----------

export type FirmChannelKind = 'channel' | 'dm' | 'group_dm';

export type FirmChannel = {
  id: string;
  firmId: string;
  name: string | null;
  topic: string | null;
  kind: FirmChannelKind;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  /** Hydrated when listing channels for a user. */
  unreadCount?: number;
  /** Hydrated for DM/group_dm so the UI can render member names. */
  memberUserIds?: string[];
};

export type FirmChannelMember = {
  id: string;
  channelId: string;
  userId: string;
  joinedAt: string;
  lastReadAt: string | null;
};

export type FirmMessage = {
  id: string;
  channelId: string;
  userId: string;
  body: string;
  attachments: FirmMessageAttachment[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Hydrated for rendering. */
  authorDisplayName?: string | null;
  authorEmail?: string | null;
};

export type FirmMessageAttachment = {
  kind: 'image' | 'file' | 'document';
  name: string;
  size?: number;
  mimeType?: string;
  /** Either a public URL or a signed URL (file/document). */
  url?: string;
  /** For document attachments referencing firm_documents.id. */
  documentId?: string;
};

// ---------- Convenience ----------

export type FirmContext = {
  firm: Firm;
  membership: FirmMember;
};
