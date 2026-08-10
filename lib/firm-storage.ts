import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { parseSignerDownloadPermission } from './signer-view';
import { parseAllowedSignatureMethods } from './signature-methods';
import { callerIsFirmMember } from './firm-authz';
import {
  isExecutedCopyPath,
  pickDocumentArtifactRequest,
} from './signing-artifact';
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
 * Server-side data layer for the firm-mode product. MOST reads go
 * through the RLS-scoped client (the user's session), and on those a
 * query for firm A cannot leak data from firm B even if the
 * application logic is buggy.
 *
 * Do not generalise that to the whole module. Reads as well as writes
 * use the admin (service-role) client where the caller has no usable
 * session or the row is deliberately outside the user's scope, and on
 * every one of them application logic is the only containment:
 * getFirmByIdAdmin, listConsumerInboxDocuments, getSignatureByToken
 * (the public /sign page), and the auth.admin.listUsers lookups inside
 * listFirmMembers and listFirmClients. Check which client a function
 * builds before relying on the guarantee above.
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
  letterhead_url: string | null;
  accent_color: string;
  jurisdictions: string[];
  practice_areas: string[];
  subdomain_enabled: boolean | null;
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
    letterheadUrl: r.letterhead_url,
    accentColor: r.accent_color,
    jurisdictions: r.jurisdictions ?? [],
    practiceAreas: r.practice_areas ?? [],
    subdomainEnabled: Boolean(r.subdomain_enabled),
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
  signable_file_path?: string | null;
  file_size: number;
  version: number;
  parent_document_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  tags: string[];
  case_id: string | null;
  client_user_id: string | null;
  archived_at: string | null;
  status: string | null;
  status_updated_at: string | null;
  description: string | null;
  due_at: string | null;
};

function documentFromRow(r: FirmDocumentRow): FirmDocument {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    mimeType: r.mime_type,
    filePath: r.file_path,
    signableFilePath: r.signable_file_path ?? null,
    fileSize: Number(r.file_size ?? 0),
    version: r.version,
    parentDocumentId: r.parent_document_id,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    tags: r.tags ?? [],
    caseId: r.case_id,
    clientUserId: r.client_user_id,
    archivedAt: r.archived_at,
    status: ((r.status ?? 'submitted') as FirmDocument['status']),
    statusUpdatedAt: r.status_updated_at ?? r.uploaded_at,
    description: r.description ?? null,
    dueAt: r.due_at ?? null,
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
  document_sha256: string | null;
  /** Optional: the column may not exist yet on older schemas. */
  signer_can_download?: boolean | null;
  /** Absent until the owner applies 20260814_signature_methods.sql, and
   *  absent from every row created before it. Both read as no restriction. */
  signature_methods?: unknown;
  /**
   * Optional on the row type on purpose. The column is additive (see
   * supabase/fixes/2026-05-14-signature-rendering-columns.sql) and is
   * absent on any deployment where that fix has not been applied, so
   * every read of it goes through `select('*')` and tolerates the
   * column simply not coming back. Naming it in a select list would
   * turn a missing column into a failed query.
   */
  signed_file_path?: string | null;
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
    documentSha256: r.document_sha256,
    signerCanDownload: parseSignerDownloadPermission(r.signer_can_download),
    signatureMethods: parseAllowedSignatureMethods(r.signature_methods),
    signedFilePath: r.signed_file_path ?? null,
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
  response: 'rejected' | 'changes_requested' | null;
  response_note: string | null;
  responded_at: string | null;
  access_code_hash: string | null;
  access_code_verified_at: string | null;
  access_attempts: number | null;
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
    response: r.response ?? null,
    responseNote: r.response_note ?? null,
    respondedAt: r.responded_at ?? null,
    // Never surface the hash - only whether a code gate applies and
    // whether it's been cleared.
    accessCodeRequired: Boolean(r.access_code_hash),
    accessVerifiedAt: r.access_code_verified_at ?? null,
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

/**
 * A firm has no billing entity of its own - "the firm's plan" really
 * means its creator's personal subscription (see the comment on
 * assertOrganizerEligible in lib/community-actions.ts, which checks
 * this same thing for Community Case eligibility). getActiveFirmContext
 * only verifies the caller is a MEMBER of the firm, never that the
 * subscription funding it is actually still active - so a firm whose
 * creator's subscription lapsed or was canceled could otherwise keep
 * using AI routes indefinitely. Callers that meter real cost per call
 * (counsel/analyze, counsel/draft-template) should check this too.
 *
 * Deliberately scoped to just those AI routes rather than folded into
 * getActiveFirmContext itself - blocking ALL portal access (team,
 * documents, clients) the instant a subscription lapses is a separate
 * product decision this doesn't make unilaterally.
 */
export async function isFirmSubscriptionActive(firm: Firm): Promise<boolean> {
  if (!firm.createdBy) return false;
  const { getSubscriptionForUser } = await import('./storage');
  const sub = await getSubscriptionForUser(firm.createdBy).catch(() => null);
  return sub?.status === 'active' || sub?.status === 'trialing';
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
 * Admin-path variant of getFirmById for callers whose entitlement is verified
 * OUTSIDE the firms RLS - e.g. a case-scoped co-counsel guest, who is not a
 * firm member (so the RLS read returns nothing) but is entitled to the firm's
 * identity (name, logo, accent) and trial clock for the guest shell chrome.
 * Callers must have already verified the user's link to this firm.
 */
export async function getFirmByIdAdmin(id: string): Promise<Firm | null> {
  const { createAdminSupabase } = await import('./supabase/admin');
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from('firms').select('*').eq('id', id).maybeSingle();
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
  // Jurisdiction is three real columns on public.cases, not a single object,
  // and the owner column is user_id (there is no owner_id). Reading the old
  // names silently produced a blank jurisdiction + undefined ownerId on every
  // firm case.
  jurisdiction_country: string | null;
  jurisdiction_state: string | null;
  jurisdiction_city: string | null;
  subject_profile: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  assigned_to: string | null;
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
      country: r.jurisdiction_country ?? '',
      state: r.jurisdiction_state ?? undefined,
      city: r.jurisdiction_city ?? undefined,
    },
    subjectProfile: (r.subject_profile as Case['subjectProfile']) ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ownerId: r.user_id,
    assignedTo: r.assigned_to ?? null,
  };
}

/**
 * Consumer-side documents inbox: every signing request currently
 * pointed at the calling user's email address, joined to its parent
 * request, document, and firm so the inbox can render firm name +
 * document name + status without N+1 lookups.
 *
 * Uses the service role because firm_signatures RLS only allows
 * firm members to read their firm's rows; consumers need to see
 * rows that target THEIR email even when they're not in the firm.
 * Caller is identified via the signed-in user from the Supabase
 * session; we never expose other people's signing rows.
 */
export type ConsumerInboxDocument = {
  signatureId: string;
  signingRequestId: string;
  token: string;
  documentName: string;
  firmName: string;
  firmAccentColor: string;
  signerEmail: string;
  signerName: string | null;
  signedAt: string | null;
  requestStatus: string;
  requestSentAt: string | null;
  requestCompletedAt: string | null;
};

export async function listConsumerInboxDocuments(
  email: string,
): Promise<ConsumerInboxDocument[]> {
  if (!email) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];

  // 1. Pull every signature row addressed to this email. Order
  //    pending first (signed_at null) then most-recently-signed.
  const { data: sigsData, error: sigsErr } = await admin
    .from('firm_signatures')
    .select(
      'id, signing_request_id, token, signer_email, signer_name, signed_at',
    )
    .eq('signer_email', email.toLowerCase())
    .order('signed_at', { ascending: false, nullsFirst: true });
  if (sigsErr) {
    console.error('[listConsumerInboxDocuments] signatures', sigsErr.message);
    return [];
  }
  const sigs = (sigsData ?? []) as Array<{
    id: string;
    signing_request_id: string;
    token: string;
    signer_email: string;
    signer_name: string | null;
    signed_at: string | null;
  }>;
  if (sigs.length === 0) return [];

  // 2. Batch-fetch the parent signing requests.
  const requestIds = Array.from(new Set(sigs.map((s) => s.signing_request_id)));
  const { data: reqsData } = await admin
    .from('firm_signing_requests')
    .select('id, status, sent_at, completed_at, document_id, firm_id')
    .in('id', requestIds);
  const reqMap = new Map<
    string,
    {
      status: string;
      sent_at: string | null;
      completed_at: string | null;
      document_id: string;
      firm_id: string;
    }
  >();
  for (const r of (reqsData ?? []) as Array<{
    id: string;
    status: string;
    sent_at: string | null;
    completed_at: string | null;
    document_id: string;
    firm_id: string;
  }>) {
    reqMap.set(r.id, r);
  }

  // 3. Batch-fetch the documents.
  const docIds = Array.from(
    new Set(
      Array.from(reqMap.values()).map((v) => v.document_id),
    ),
  );
  const { data: docsData } = await admin
    .from('firm_documents')
    .select('id, name')
    .in('id', docIds);
  const docMap = new Map<string, string>();
  for (const d of (docsData ?? []) as Array<{ id: string; name: string }>) {
    docMap.set(d.id, d.name);
  }

  // 4. Batch-fetch the firms.
  const firmIds = Array.from(
    new Set(Array.from(reqMap.values()).map((v) => v.firm_id)),
  );
  const { data: firmsData } = await admin
    .from('firms')
    .select('id, name, accent_color')
    .in('id', firmIds);
  const firmMap = new Map<string, { name: string; accent: string }>();
  for (const f of (firmsData ?? []) as Array<{
    id: string;
    name: string;
    accent_color: string;
  }>) {
    firmMap.set(f.id, { name: f.name, accent: f.accent_color });
  }

  return sigs
    .map((s) => {
      const r = reqMap.get(s.signing_request_id);
      if (!r) return null;
      const firm = firmMap.get(r.firm_id);
      return {
        signatureId: s.id,
        signingRequestId: s.signing_request_id,
        token: s.token,
        documentName: docMap.get(r.document_id) ?? 'Document',
        firmName: firm?.name ?? 'Firm',
        firmAccentColor: firm?.accent ?? '#1f4936',
        signerEmail: s.signer_email,
        signerName: s.signer_name,
        signedAt: s.signed_at,
        requestStatus: r.status,
        requestSentAt: r.sent_at,
        requestCompletedAt: r.completed_at,
      } as ConsumerInboxDocument;
    })
    .filter((v): v is ConsumerInboxDocument => v !== null);
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

/**
 * A signed URL for the EXECUTED copy of one signing request.
 *
 * Separate from getFirmDocumentSignedUrl above because the two paths
 * do not live in the same place. An uploaded firm document is written
 * to `<firm-id>/<doc-id>/<name>` and the user-scoped client reads it
 * under storage RLS. The executed copy is written by the render step
 * to `signed/<request-id>/final.pdf`, which carries no firm id, so
 * the firm-prefix policy the bucket is organised around cannot admit
 * it. It is minted through the service-role client instead.
 *
 * Which means the two checks here ARE the authorization, and neither
 * is a new one:
 *   - firm membership, through the shared lib/firm-authz.ts helper
 *     that every other firm surface uses. Any member may already open
 *     the document this executed copy is derived from, so membership
 *     is the same bar, not a lower one.
 *   - path confinement to `signed/<request-id>/`, so a stored path
 *     can only ever name this request's own copy.
 */
export async function getFirmExecutedCopySignedUrl(input: {
  firmId: string;
  requestId: string;
  filePath: string | null | undefined;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const path = input.filePath?.trim();
  if (!input.firmId || !path) return null;
  if (!isExecutedCopyPath(input.requestId, path)) return null;
  if (!(await callerIsFirmMember(input.firmId))) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from('firm-documents')
    .createSignedUrl(path, input.expiresInSeconds ?? 60 * 10);
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

export type FirmSigningRequestSummary = FirmSigningRequest & {
  recipients: string[];
  signedCount: number;
  totalSigners: number;
};

/**
 * Signing requests plus a per-request signer summary (who it was sent
 * to, how many signed) - one extra batched query, aggregated in JS.
 * Powers the signing list's at-a-glance recipient + progress column.
 */
export async function listFirmSigningRequestsWithSummary(
  firmId: string,
): Promise<FirmSigningRequestSummary[]> {
  const requests = await listFirmSigningRequests(firmId);
  if (requests.length === 0) return [];
  const supabase = createServerSupabase();
  const { data: sigs } = await supabase
    .from('firm_signatures')
    .select('signing_request_id, signer_name, signer_email, signed_at')
    .in(
      'signing_request_id',
      requests.map((r) => r.id),
    );
  const byReq = new Map<
    string,
    { recipients: string[]; signed: number; total: number }
  >();
  for (const s of (sigs ?? []) as Array<{
    signing_request_id: string;
    signer_name: string | null;
    signer_email: string;
    signed_at: string | null;
  }>) {
    const entry =
      byReq.get(s.signing_request_id) ?? { recipients: [], signed: 0, total: 0 };
    entry.recipients.push(s.signer_name || s.signer_email);
    entry.total += 1;
    if (s.signed_at) entry.signed += 1;
    byReq.set(s.signing_request_id, entry);
  }
  return requests.map((r) => {
    const e = byReq.get(r.id);
    return {
      ...r,
      recipients: e?.recipients ?? [],
      signedCount: e?.signed ?? 0,
      totalSigners: e?.total ?? 0,
    };
  });
}

/**
 * The signing request a document page should speak for, if any.
 *
 * The document page shows a document, not a request, so it has no
 * request to read an executed copy off. This is that lookup. The
 * ranking is pickDocumentArtifactRequest, kept in lib/signing-artifact
 * with the rest of the decision and unit-tested there: a completed
 * request first, so the executed copy wins, and failing that one still
 * collecting signatures, so the page can say that some signers are out
 * rather than claiming nothing has been signed onto the document.
 *
 * `select('*')` on purpose, see FirmSigningRequestRow.signed_file_path.
 */
export async function getDocumentArtifactSigningRequest(
  documentId: string,
): Promise<FirmSigningRequest | null> {
  if (!documentId) return null;
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_signing_requests')
    .select('*')
    .eq('document_id', documentId)
    .in('status', ['completed', 'partial'])
    .order('created_at', { ascending: false })
    .limit(25);
  if (!data) return null;
  const rows = (data as FirmSigningRequestRow[]).map(signingRequestFromRow);
  return pickDocumentArtifactRequest(rows);
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

/**
 * Make sure the firm has a shared "legal-team" channel that EVERY
 * firm member is in, and re-sync membership so newly added teammates
 * can chat immediately. Without this a fresh firm lands on an empty
 * chat, and createFirmChannelAction only adds the creator - so the
 * legal department could never actually talk to each other. Runs on
 * every chat page load (idempotent, service-role for cross-user
 * member rows). Returns the channel id, or null if unavailable.
 */
export async function ensureFirmTeamChannel(
  firmId: string,
  createdBy: string,
): Promise<string | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  try {
    let channelId: string | null = null;
    const { data: existing } = await admin
      .from('firm_channels')
      .select('id')
      .eq('firm_id', firmId)
      .eq('is_default', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing) channelId = (existing as { id: string }).id;
    if (!channelId) {
      const { data: created, error } = await admin
        .from('firm_channels')
        .insert({
          firm_id: firmId,
          name: 'legal-team',
          topic: 'Firm-wide channel for the legal team',
          kind: 'channel',
          is_default: true,
          created_by: createdBy,
        })
        .select('id')
        .single();
      if (error || !created) return null;
      channelId = (created as { id: string }).id;
    }
    // Resync: every firm member should be a channel member.
    const { data: mem } = await admin
      .from('firm_members')
      .select('user_id')
      .eq('firm_id', firmId);
    const memberIds = new Set(
      ((mem ?? []) as Array<{ user_id: string | null }>)
        .map((m) => m.user_id)
        .filter((u): u is string => Boolean(u)),
    );
    const { data: cur } = await admin
      .from('firm_channel_members')
      .select('user_id')
      .eq('channel_id', channelId);
    const have = new Set(
      ((cur ?? []) as Array<{ user_id: string }>).map((m) => m.user_id),
    );
    const channel = channelId;
    const toAdd = [...memberIds]
      .filter((id) => !have.has(id))
      .map((uid) => ({ channel_id: channel, user_id: uid }));
    if (toAdd.length) {
      await admin.from('firm_channel_members').insert(toAdd);
    }
    return channelId;
  } catch {
    return null;
  }
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
