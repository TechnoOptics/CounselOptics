import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import type {
  Firm,
  FirmChannel,
  FirmChannelKind,
  FirmClient,
  FirmContext,
  FirmDocument,
  FirmInvitation,
  FirmMember,
  FirmMessage,
  FirmRole,
  FirmSignature,
  FirmSigningRequest,
  FirmSigningStatus,
} from './firm-types';

/**
 * Server-side data layer for the firm-mode product. Every read goes
 * through the RLS-scoped client (the user's session) so a query for
 * firm A can never leak data from firm B even if the application
 * logic is buggy. The few writes that need to bypass RLS - accepting
 * an invitation, recording a signature on the public /sign page -
 * use the admin (service-role) client and validate authorization in
 * application code.
 */

// ============================================================================
// Row -> camelCase mappers
// ============================================================================

type FirmRow = {
  id: string;
  slug: string;
  name: string;
  firm_type: 'individual' | 'firm' | 'corporate' | 'government' | 'legal_aid' | 'other';
  metadata: Record<string, unknown> | null;
  logo_url: string | null;
  accent_color: string;
  jurisdictions: string[];
  practice_areas: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function firmFromRow(r: FirmRow): Firm {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    firmType: r.firm_type,
    metadata: (r.metadata ?? {}) as Firm['metadata'],
    logoUrl: r.logo_url,
    accentColor: r.accent_color,
    jurisdictions: r.jurisdictions ?? [],
    practiceAreas: r.practice_areas ?? [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type FirmMemberRow = {
  id: string;
  firm_id: string;
  user_id: string;
  role: FirmRole;
  display_name: string | null;
  joined_at: string;
};

function memberFromRow(r: FirmMemberRow, email: string | null = null): FirmMember {
  return {
    id: r.id,
    firmId: r.firm_id,
    userId: r.user_id,
    role: r.role,
    displayName: r.display_name,
    email,
    joinedAt: r.joined_at,
  };
}

type FirmInvitationRow = {
  id: string;
  firm_id: string;
  email: string;
  role: FirmRole;
  invited_by: string | null;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

function invitationFromRow(r: FirmInvitationRow): FirmInvitation {
  return {
    id: r.id,
    firmId: r.firm_id,
    email: r.email,
    role: r.role,
    invitedBy: r.invited_by,
    token: r.token,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at,
    createdAt: r.created_at,
  };
}

type FirmClientRow = {
  id: string;
  firm_id: string;
  user_id: string;
  primary_attorney_id: string | null;
  invited_by: string | null;
  status: 'invited' | 'active' | 'archived';
  joined_at: string;
};

function clientFromRow(r: FirmClientRow): FirmClient {
  return {
    id: r.id,
    firmId: r.firm_id,
    userId: r.user_id,
    primaryAttorneyId: r.primary_attorney_id,
    invitedBy: r.invited_by,
    status: r.status,
    joinedAt: r.joined_at,
  };
}

type FirmDocumentRow = {
  id: string;
  firm_id: string;
  name: string;
  mime_type: string;
  file_path: string;
  file_size: number;
  version: number;
  parent_document_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  tags: string[];
  case_id: string | null;
  client_user_id: string | null;
  archived_at: string | null;
};

function documentFromRow(r: FirmDocumentRow): FirmDocument {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    mimeType: r.mime_type,
    filePath: r.file_path,
    fileSize: Number(r.file_size ?? 0),
    version: r.version,
    parentDocumentId: r.parent_document_id,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    tags: r.tags ?? [],
    caseId: r.case_id,
    clientUserId: r.client_user_id,
    archivedAt: r.archived_at,
  };
}

type FirmSigningRequestRow = {
  id: string;
  firm_id: string;
  document_id: string;
  requested_by: string;
  status: FirmSigningStatus;
  message: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
};

function signingRequestFromRow(r: FirmSigningRequestRow): FirmSigningRequest {
  return {
    id: r.id,
    firmId: r.firm_id,
    documentId: r.document_id,
    requestedBy: r.requested_by,
    status: r.status,
    message: r.message,
    sentAt: r.sent_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}

type FirmSignatureRow = {
  id: string;
  signing_request_id: string;
  signer_user_id: string | null;
  signer_email: string;
  signer_name: string | null;
  token: string;
  position_page: number | null;
  position_x: number | null;
  position_y: number | null;
  signed_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signature_image_path: string | null;
  audit_hash: string | null;
  created_at: string;
};

function signatureFromRow(r: FirmSignatureRow): FirmSignature {
  return {
    id: r.id,
    signingRequestId: r.signing_request_id,
    signerUserId: r.signer_user_id,
    signerEmail: r.signer_email,
    signerName: r.signer_name,
    token: r.token,
    positionPage: r.position_page,
    positionX: r.position_x,
    positionY: r.position_y,
    signedAt: r.signed_at,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    signatureImagePath: r.signature_image_path,
    auditHash: r.audit_hash,
    createdAt: r.created_at,
  };
}

type FirmChannelRow = {
  id: string;
  firm_id: string;
  name: string | null;
  topic: string | null;
  kind: FirmChannelKind;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
};

function channelFromRow(r: FirmChannelRow): FirmChannel {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    topic: r.topic,
    kind: r.kind,
    isDefault: r.is_default,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

type FirmMessageRow = {
  id: string;
  channel_id: string;
  user_id: string;
  body: string;
  attachments: unknown;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

function messageFromRow(r: FirmMessageRow): FirmMessage {
  return {
    id: r.id,
    channelId: r.channel_id,
    userId: r.user_id,
    body: r.body,
    attachments: Array.isArray(r.attachments) ? (r.attachments as FirmMessage['attachments']) : [],
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
  };
}

// ============================================================================
// Firms + membership
// ============================================================================

/**
 * Returns every firm the current user is a member of, with their
 * membership row attached. RLS scopes this to the user's own
 * memberships automatically.
 */
export async function listMyFirms(): Promise<
  Array<{ firm: Firm; membership: FirmMember }>
> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_members')
    .select('id, firm_id, user_id, role, display_name, joined_at, firm:firms(*)')
    .eq('user_id', user.id);
  if (error || !data) return [];
  // Supabase typing returns the joined `firm` as an array even for
  // a 1:1 relationship. Normalize to a single row.
  return (data as unknown as Array<FirmMemberRow & { firm: FirmRow | FirmRow[] | null }>)
    .map((row) => {
      const firmRow = Array.isArray(row.firm) ? row.firm[0] : row.firm;
      if (!firmRow) return null;
      return {
        firm: firmFromRow(firmRow),
        membership: memberFromRow(row, user.email ?? null),
      };
    })
    .filter((e): e is { firm: Firm; membership: FirmMember } => e !== null);
}

/**
 * Resolves the active-firm context: the firm the user is currently
 * viewing (their `profiles.active_firm_id`), plus their membership in
 * it. Returns null when the user has no active firm or the active
 * firm has been deleted.
 */
export async function getActiveFirmContext(): Promise<FirmContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('active_firm_id')
    .eq('id', user.id)
    .maybeSingle();
  const activeFirmId = (profile as { active_firm_id?: string | null } | null)
    ?.active_firm_id;
  if (!activeFirmId) return null;
  const { data, error } = await supabase
    .from('firm_members')
    .select('id, firm_id, user_id, role, display_name, joined_at, firm:firms(*)')
    .eq('firm_id', activeFirmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as FirmMemberRow & { firm: FirmRow | FirmRow[] | null };
  const firmRow = Array.isArray(row.firm) ? row.firm[0] : row.firm;
  if (!firmRow) return null;
  return {
    firm: firmFromRow(firmRow),
    membership: memberFromRow(row, user.email ?? null),
  };
}

export async function getFirmBySlug(slug: string): Promise<Firm | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firms')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (!data) return null;
  return firmFromRow(data as FirmRow);
}

export async function getFirmById(id: string): Promise<Firm | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase.from('firms').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  return firmFromRow(data as FirmRow);
}

/**
 * Lists members of the active firm, hydrated with email + display
 * name from auth.users / profiles for the team-management UI.
 */
export async function listFirmMembers(firmId: string): Promise<FirmMember[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_members')
    .select('id, firm_id, user_id, role, display_name, joined_at')
    .eq('firm_id', firmId)
    .order('joined_at', { ascending: true });
  if (error || !data) return [];
  const members = (data as FirmMemberRow[]).map((r) => memberFromRow(r));
  // Hydrate emails via the admin client (service-role bypass) so the
  // UI can show "alice@example.com" next to roles. Users who never
  // signed in (still on an invitation) will be missing - that is OK.
  const admin = createAdminSupabase();
  if (!admin || members.length === 0) return members;
  const ids = members.map((m) => m.userId);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const map = new Map<string, string | null>();
  for (const u of users?.users ?? []) {
    if (ids.includes(u.id)) map.set(u.id, u.email ?? null);
  }
  return members.map((m) => ({ ...m, email: map.get(m.userId) ?? null }));
}

export async function listFirmInvitations(firmId: string): Promise<FirmInvitation[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_invitations')
    .select('*')
    .eq('firm_id', firmId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (!data) return [];
  return (data as FirmInvitationRow[]).map(invitationFromRow);
}

export async function listFirmClients(firmId: string): Promise<FirmClient[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_clients')
    .select('*')
    .eq('firm_id', firmId)
    .order('joined_at', { ascending: false });
  if (!data) return [];
  const clients = (data as FirmClientRow[]).map(clientFromRow);
  const admin = createAdminSupabase();
  if (!admin || clients.length === 0) return clients;
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const map = new Map<string, string | null>();
  for (const u of users?.users ?? []) {
    if (clients.some((c) => c.userId === u.id)) map.set(u.id, u.email ?? null);
  }
  return clients.map((c) => ({ ...c, email: map.get(c.userId) ?? null }));
}

// ============================================================================
// Firm-shared cases
// ============================================================================

import type { Case } from './types';

type CaseRow = {
  id: string;
  firm_id: string | null;
  title: string;
  subject_name: string;
  subject_type: string;
  case_type: string;
  posture: string | null;
  description: string | null;
  hearing_at: string | null;
  hearing_location: string | null;
  hearing_notes: string | null;
  status: string;
  jurisdiction: { country?: string | null; state?: string | null; city?: string | null } | null;
  subject_profile: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  owner_id: string;
};

function firmCaseFromRow(r: CaseRow): Case {
  return {
    id: r.id,
    title: r.title,
    subjectName: r.subject_name,
    subjectType: r.subject_type as Case['subjectType'],
    caseType: r.case_type as Case['caseType'],
    posture: (r.posture as Case['posture']) ?? 'claimant',
    description: r.description ?? '',
    hearingAt: r.hearing_at,
    hearingLocation: r.hearing_location,
    hearingNotes: r.hearing_notes,
    status: r.status as Case['status'],
    jurisdiction: {
      country: r.jurisdiction?.country ?? '',
      state: r.jurisdiction?.state ?? undefined,
      city: r.jurisdiction?.city ?? undefined,
    },
    subjectProfile: (r.subject_profile as Case['subjectProfile']) ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ownerId: r.owner_id,
  };
}

/**
 * Cases shared with the firm (i.e. cases.firm_id = firmId). RLS
 * already restricts the user-scoped client to firm members; this
 * function additionally filters to a specific firm so a user in
 * multiple firms only sees the active firm's cases.
 */
export async function listFirmCases(firmId: string): Promise<Case[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('cases')
    .select('*')
    .eq('firm_id', firmId)
    .order('updated_at', { ascending: false });
  if (!data) return [];
  return (data as CaseRow[]).map(firmCaseFromRow);
}

// ============================================================================
// Documents + signing
// ============================================================================

export async function listFirmDocuments(firmId: string): Promise<FirmDocument[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_documents')
    .select('*')
    .eq('firm_id', firmId)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false });
  if (!data) return [];
  return (data as FirmDocumentRow[]).map(documentFromRow);
}

export async function getFirmDocument(documentId: string): Promise<FirmDocument | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (!data) return null;
  return documentFromRow(data as FirmDocumentRow);
}

export async function getFirmDocumentSignedUrl(
  filePath: string,
  expiresInSeconds = 60 * 10,
): Promise<string | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.storage
    .from('firm-documents')
    .createSignedUrl(filePath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function listFirmSigningRequests(firmId: string): Promise<FirmSigningRequest[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_signing_requests')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false });
  if (!data) return [];
  return (data as FirmSigningRequestRow[]).map(signingRequestFromRow);
}

export async function getFirmSigningRequestWithSignatures(
  requestId: string,
): Promise<{ request: FirmSigningRequest; signatures: FirmSignature[] } | null> {
  const supabase = createServerSupabase();
  const { data: req } = await supabase
    .from('firm_signing_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return null;
  const { data: sigs } = await supabase
    .from('firm_signatures')
    .select('*')
    .eq('signing_request_id', requestId)
    .order('created_at', { ascending: true });
  return {
    request: signingRequestFromRow(req as FirmSigningRequestRow),
    signatures: (sigs ?? []).map((r) => signatureFromRow(r as FirmSignatureRow)),
  };
}

/**
 * Look up a pending signature by its public token. Used by the
 * /sign/[token] route which has no signed-in user. Runs through the
 * admin client because the policy on firm_signatures gates reads to
 * firm members + the user themselves; the signer may not even have
 * an account yet.
 */
export async function getSignatureByToken(token: string): Promise<{
  signature: FirmSignature;
  request: FirmSigningRequest;
  document: FirmDocument;
  firm: Firm;
} | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data: sig } = await admin
    .from('firm_signatures')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (!sig) return null;
  const sigRow = sig as FirmSignatureRow;
  const { data: req } = await admin
    .from('firm_signing_requests')
    .select('*')
    .eq('id', sigRow.signing_request_id)
    .maybeSingle();
  if (!req) return null;
  const reqRow = req as FirmSigningRequestRow;
  const { data: doc } = await admin
    .from('firm_documents')
    .select('*')
    .eq('id', reqRow.document_id)
    .maybeSingle();
  if (!doc) return null;
  const { data: firm } = await admin
    .from('firms')
    .select('*')
    .eq('id', reqRow.firm_id)
    .maybeSingle();
  if (!firm) return null;
  return {
    signature: signatureFromRow(sigRow),
    request: signingRequestFromRow(reqRow),
    document: documentFromRow(doc as FirmDocumentRow),
    firm: firmFromRow(firm as FirmRow),
  };
}

// ============================================================================
// Chat
// ============================================================================

export async function listChannelsForUser(firmId: string): Promise<FirmChannel[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = createServerSupabase();
  const { data: channels } = await supabase
    .from('firm_channels')
    .select(
      'id, firm_id, name, topic, kind, is_default, created_by, created_at, members:firm_channel_members!inner(user_id, last_read_at)',
    )
    .eq('firm_id', firmId)
    .eq('members.user_id', user.id)
    .order('created_at', { ascending: true });
  if (!channels) return [];
  return (channels as Array<FirmChannelRow & { members: Array<{ user_id: string; last_read_at: string | null }> }>).map(
    (c) => channelFromRow(c),
  );
}

export async function listMessages(
  channelId: string,
  limit = 50,
): Promise<FirmMessage[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_messages')
    .select('*')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!data) return [];
  return (data as FirmMessageRow[]).map(messageFromRow).reverse();
}
