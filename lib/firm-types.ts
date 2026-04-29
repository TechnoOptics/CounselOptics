/**
 * Type surface for the law-firm perspective ("Advottic Counsel").
 * Server boundary returns these shapes; everything inside firm-mode
 * routes consumes them.
 *
 * See docs/LAW_FIRM_MODE.md for the architecture overview.
 */

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
