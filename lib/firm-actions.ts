'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser, requireUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { sendEmail } from './email';
import type { FirmRole, FirmSigningStatus, FirmType } from './firm-types';
import { FIRM_ROLES, FIRM_TYPES } from './firm-types';

/**
 * Server actions powering the law-firm perspective.
 *
 * Anything that needs to reach across firms (accept-invitation,
 * record-signature on /sign/[token]) goes through the admin client.
 * Everything else uses the user-scoped client so RLS does the
 * authorization for us.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// =====================================================================
// Firm onboarding + perspective toggle
// =====================================================================

export type CreateFirmResult = {
  ok: boolean;
  error?: string;
  firmId?: string;
  slug?: string;
};

export async function createFirmAction(formData: FormData): Promise<CreateFirmResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const name = String(formData.get('name') ?? '').trim();
  const slugInput = String(formData.get('slug') ?? '').trim();
  const accentColor = String(formData.get('accentColor') ?? '#0f2d24').trim();
  const logoUrl = String(formData.get('logoUrl') ?? '').trim() || null;
  const jurisdictions = parseList(String(formData.get('jurisdictions') ?? ''));
  const practiceAreas = parseList(String(formData.get('practiceAreas') ?? ''));
  const firmTypeRaw = String(formData.get('firmType') ?? 'firm');
  const firmType = (FIRM_TYPES.includes(firmTypeRaw as FirmType)
    ? firmTypeRaw
    : 'firm') as FirmType;
  // Type-specific metadata is sent as a JSON string under "metadata"
  // so the wizard can pass an arbitrary shape per firm type without
  // exploding the action signature.
  let metadata: Record<string, unknown> = {};
  try {
    const raw = String(formData.get('metadata') ?? '').trim();
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    }
  } catch {
    metadata = {};
  }

  if (!name) return { ok: false, error: 'Firm name is required.' };
  const slug = slugInput ? slugify(slugInput) : slugify(name);
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      error:
        'Slug must be 1-40 lowercase letters, numbers, or hyphens (no leading/trailing hyphen).',
    };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    return { ok: false, error: 'Accent color must be a 7-character hex like #0f2d24.' };
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return {
      ok: false,
      error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY; cannot create firm.',
    };
  }
  // Slug uniqueness check before insert.
  const { data: existing } = await admin
    .from('firms')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: `The slug "${slug}" is already taken. Pick another.`,
    };
  }

  // Insert firm + owner membership in a single round trip via the
  // admin client so we do not have to manage transactions across the
  // user-scoped + admin clients.
  const { data: firm, error: firmErr } = await admin
    .from('firms')
    .insert({
      name,
      slug,
      firm_type: firmType,
      metadata,
      logo_url: logoUrl,
      accent_color: accentColor,
      jurisdictions,
      practice_areas: practiceAreas,
      created_by: user.id,
    })
    .select('id, slug')
    .single();
  if (firmErr || !firm) {
    return { ok: false, error: firmErr?.message ?? 'Could not create firm.' };
  }
  const { error: memErr } = await admin.from('firm_members').insert({
    firm_id: firm.id,
    user_id: user.id,
    role: 'owner' as FirmRole,
    display_name:
      (user.user_metadata?.full_name as string | undefined) ||
      user.email ||
      null,
  });
  if (memErr) {
    // Best-effort cleanup if the member insert failed.
    await admin.from('firms').delete().eq('id', firm.id);
    return { ok: false, error: memErr.message };
  }

  // Default channel: #general, with the owner as a member.
  const { data: channel } = await admin
    .from('firm_channels')
    .insert({
      firm_id: firm.id,
      name: 'general',
      topic: 'Default firm-wide channel',
      kind: 'channel',
      is_default: true,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (channel) {
    await admin.from('firm_channel_members').insert({
      channel_id: (channel as { id: string }).id,
      user_id: user.id,
    });
  }

  // Activate this firm for the creator.
  await admin
    .from('profiles')
    .update({ active_firm_id: firm.id })
    .eq('id', user.id);

  revalidatePath('/counsel');
  return { ok: true, firmId: firm.id, slug: firm.slug };
}

export async function updateFirmAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const name = String(formData.get('name') ?? '').trim();
  const accentColor = String(formData.get('accentColor') ?? '').trim();
  const logoUrl = String(formData.get('logoUrl') ?? '').trim() || null;
  const jurisdictions = parseList(String(formData.get('jurisdictions') ?? ''));
  const practiceAreas = parseList(String(formData.get('practiceAreas') ?? ''));
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    return { ok: false, error: 'Accent color must be a 7-character hex like #0f2d24.' };
  }
  const supabase = createServerSupabase();
  // RLS gates this - only owner/admin can update.
  const { error } = await supabase
    .from('firms')
    .update({
      name,
      accent_color: accentColor,
      logo_url: logoUrl,
      jurisdictions,
      practice_areas: practiceAreas,
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

export async function setActiveFirmAction(
  firmId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = createServerSupabase();
  if (firmId) {
    // Confirm membership before activating.
    const { data: member } = await supabase
      .from('firm_members')
      .select('id')
      .eq('firm_id', firmId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) {
      return { ok: false, error: 'You are not a member of that firm.' };
    }
  }
  const { error } = await supabase
    .from('profiles')
    .update({ active_firm_id: firmId })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  revalidatePath('/counsel');
  return { ok: true };
}

// =====================================================================
// Member invitations
// =====================================================================

export async function inviteFirmMemberAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'staff') as FirmRole;
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Enter a valid email.' };
  }
  if (!FIRM_ROLES.includes(role) || role === 'owner') {
    return { ok: false, error: 'Invalid role.' };
  }
  const supabase = createServerSupabase();
  // RLS gates the insert: only owner/admin can write.
  const token = newToken(32);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { data: firm } = await supabase
    .from('firms')
    .select('id, name, slug')
    .eq('id', firmId)
    .maybeSingle();
  if (!firm) return { ok: false, error: 'Firm not found or you lack access.' };
  const { error } = await supabase.from('firm_invitations').insert({
    firm_id: firmId,
    email,
    role,
    invited_by: user.id,
    token,
    expires_at: expires.toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  // Fire-and-forget invitation email.
  const url =
    (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://www.advottic.com') +
    `/counsel/accept-invite?token=${encodeURIComponent(token)}`;
  const firmName = (firm as { name: string }).name;
  await sendEmail({
    to: email,
    subject: `You're invited to ${firmName} on Advottic`,
    html: `<p>${escapeHtml(firmName)} added you as <strong>${escapeHtml(role)}</strong> on Advottic Counsel.</p><p><a href="${escapeHtml(url)}">Accept the invitation</a></p><p>Link expires in 7 days.</p>`,
    text: `${firmName} added you as ${role} on Advottic Counsel.\n\nAccept the invitation:\n${url}\n\nLink expires in 7 days.`,
  }).catch(() => {});
  revalidatePath('/counsel/team');
  return { ok: true };
}

export async function acceptFirmInvitationAction(
  token: string,
): Promise<{ ok: boolean; error?: string; firmId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first to accept the invitation.' };
  if (!user.email) return { ok: false, error: 'No email on your account.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  const { data: inv } = await admin
    .from('firm_invitations')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (!inv) return { ok: false, error: 'Invitation not found.' };
  const invRow = inv as {
    id: string;
    firm_id: string;
    email: string;
    role: FirmRole;
    expires_at: string;
    accepted_at: string | null;
  };
  if (invRow.accepted_at) return { ok: false, error: 'Invitation already used.' };
  if (Date.parse(invRow.expires_at) < Date.now()) {
    return { ok: false, error: 'Invitation has expired. Ask for a new one.' };
  }
  if (invRow.email.toLowerCase() !== user.email.toLowerCase()) {
    return {
      ok: false,
      error: `This invitation was sent to ${invRow.email}. Sign in with that email.`,
    };
  }
  // Insert membership (idempotent via UNIQUE constraint - if they
  // were already added we still mark the invite accepted).
  await admin
    .from('firm_members')
    .insert({
      firm_id: invRow.firm_id,
      user_id: user.id,
      role: invRow.role,
      display_name:
        (user.user_metadata?.full_name as string | undefined) || user.email || null,
    })
    .select('id')
    .maybeSingle();
  // Add the new member to the default #general channel if it exists.
  const { data: defaultChan } = await admin
    .from('firm_channels')
    .select('id')
    .eq('firm_id', invRow.firm_id)
    .eq('is_default', true)
    .maybeSingle();
  if (defaultChan) {
    await admin
      .from('firm_channel_members')
      .insert({
        channel_id: (defaultChan as { id: string }).id,
        user_id: user.id,
      })
      .select('id')
      .maybeSingle();
  }
  await admin
    .from('firm_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invRow.id);
  // Activate the firm for the user.
  await admin
    .from('profiles')
    .update({ active_firm_id: invRow.firm_id })
    .eq('id', user.id);
  revalidatePath('/counsel');
  return { ok: true, firmId: invRow.firm_id };
}

export async function removeFirmMemberAction(
  firmId: string,
  memberUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_members')
    .delete()
    .eq('firm_id', firmId)
    .eq('user_id', memberUserId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/team');
  return { ok: true };
}

export async function updateFirmMemberRoleAction(
  firmId: string,
  memberUserId: string,
  newRole: FirmRole,
): Promise<{ ok: boolean; error?: string }> {
  if (!FIRM_ROLES.includes(newRole)) return { ok: false, error: 'Invalid role.' };
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_members')
    .update({ role: newRole })
    .eq('firm_id', firmId)
    .eq('user_id', memberUserId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/team');
  return { ok: true };
}

// =====================================================================
// Clients
// =====================================================================

export async function inviteFirmClientAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const displayName = String(formData.get('displayName') ?? '').trim() || null;
  if (!email || !email.includes('@')) return { ok: false, error: 'Enter a valid email.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  // Look up an existing user by email; if none, send them a magic
  // link inviting them to set up Advottic. This function intentionally
  // does NOT pre-create a user account - the user owns their account
  // creation.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const match = (users?.users ?? []).find(
    (u) => (u.email ?? '').toLowerCase() === email,
  );
  if (match) {
    // User exists. Add the firm_clients link straight away.
    const { error: linkErr } = await admin
      .from('firm_clients')
      .insert({
        firm_id: firmId,
        user_id: match.id,
        primary_attorney_id: user.id,
        invited_by: user.id,
        status: 'active',
      })
      .select('id')
      .maybeSingle();
    if (linkErr && !String(linkErr.message).includes('duplicate')) {
      return { ok: false, error: linkErr.message };
    }
  } else {
    // No user yet. Send a magic link with a redirect to the consumer
    // welcome flow; the firm_clients row will be filled in after they
    // sign in (we record the pending invite by email instead).
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo:
        (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://www.advottic.com') +
        '/welcome',
      data: { invited_by_firm_id: firmId, display_name: displayName },
    });
  }
  // Email a friendly note in either case.
  const { data: firm } = await admin
    .from('firms')
    .select('name')
    .eq('id', firmId)
    .maybeSingle();
  const firmName2 = (firm as { name?: string } | null)?.name ?? 'A firm';
  await sendEmail({
    to: email,
    subject: `${firmName2} invited you to Advottic`,
    html: `<p>Your attorney's office added you to Advottic so you can share documents, sign agreements, and communicate securely.</p><p>If you already have an Advottic account, <a href="https://www.advottic.com/sign-in">sign in here</a>. Otherwise, watch for a sign-in link from Advottic.</p>`,
    text: `Your attorney's office added you to Advottic so you can share documents, sign agreements, and communicate securely.\n\nIf you already have an Advottic account, sign in at https://www.advottic.com/sign-in. Otherwise, watch for a sign-in link from Advottic.`,
  }).catch(() => {});
  revalidatePath('/counsel/clients');
  return { ok: true };
}

// =====================================================================
// Documents
// =====================================================================

export async function uploadFirmDocumentAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; documentId?: string }> {
  const user = await requireUser();
  const file = formData.get('file');
  const name = String(formData.get('name') ?? '').trim();
  const tagsRaw = String(formData.get('tags') ?? '').trim();
  const caseId = String(formData.get('caseId') ?? '').trim() || null;
  const clientUserId = String(formData.get('clientUserId') ?? '').trim() || null;

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file to upload.' };
  }
  if (file.size > 50 * 1024 * 1024) {
    return { ok: false, error: 'File is over the 50 MB limit.' };
  }
  const supabase = createServerSupabase();
  // Membership gate (RLS would also catch this).
  const { data: member } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  const role = (member as { role: FirmRole }).role;
  if (!['owner', 'admin', 'attorney', 'paralegal'].includes(role)) {
    return { ok: false, error: 'Your role cannot upload documents.' };
  }
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_ ]/g, '').slice(0, 100);
  const filePath = `${firmId}/${id}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage
    .from('firm-documents')
    .upload(filePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadErr) return { ok: false, error: uploadErr.message };
  const { data: doc, error: insertErr } = await supabase
    .from('firm_documents')
    .insert({
      id,
      firm_id: firmId,
      name: name || safeName,
      mime_type: file.type || 'application/octet-stream',
      file_path: filePath,
      file_size: file.size,
      version: 1,
      uploaded_by: user.id,
      tags: parseList(tagsRaw),
      case_id: caseId,
      client_user_id: clientUserId,
    })
    .select('id')
    .single();
  if (insertErr || !doc) return { ok: false, error: insertErr?.message ?? 'Insert failed.' };
  revalidatePath('/counsel/documents');
  return { ok: true, documentId: (doc as { id: string }).id };
}

// =====================================================================
// Signing
// =====================================================================

export async function createSigningRequestAction(
  firmId: string,
  documentId: string,
  signers: Array<{ email: string; name?: string; positionPage?: number; positionX?: number; positionY?: number }>,
  message: string | null,
): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  const user = await requireUser();
  if (signers.length === 0) return { ok: false, error: 'Add at least one signer.' };
  const supabase = createServerSupabase();
  const { data: req, error: reqErr } = await supabase
    .from('firm_signing_requests')
    .insert({
      firm_id: firmId,
      document_id: documentId,
      requested_by: user.id,
      message,
      status: 'sent' as FirmSigningStatus,
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (reqErr || !req) return { ok: false, error: reqErr?.message ?? 'Could not create request.' };
  const requestId = (req as { id: string }).id;
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  const { data: doc } = await admin
    .from('firm_documents')
    .select('name')
    .eq('id', documentId)
    .maybeSingle();
  const docName = (doc as { name?: string } | null)?.name ?? 'Document';
  for (const signer of signers) {
    const token = newToken(32);
    await admin.from('firm_signatures').insert({
      signing_request_id: requestId,
      signer_email: signer.email.trim().toLowerCase(),
      signer_name: signer.name?.trim() || null,
      token,
      position_page: signer.positionPage ?? 1,
      position_x: signer.positionX ?? 0.1,
      position_y: signer.positionY ?? 0.1,
    });
    const url =
      (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://www.advottic.com') +
      `/sign/${token}`;
    await sendEmail({
      to: signer.email,
      subject: `Signature requested: ${docName}`,
      html: `<p>${escapeHtml(user.email ?? 'A team member')} requested your signature on "<strong>${escapeHtml(docName)}</strong>".</p><p><a href="${escapeHtml(url)}">Review and sign in Advottic</a> (the link stays inside the app, the document never leaves).</p><p>This link is single-use.</p>`,
      text: `${user.email ?? 'A team member'} requested your signature on "${docName}".\n\nReview and sign in Advottic (the link stays inside the app, the document never leaves):\n${url}\n\nThis link is single-use.`,
    }).catch(() => {});
  }
  revalidatePath('/counsel/signing');
  return { ok: true, requestId };
}

// =====================================================================
// Chat
// =====================================================================

export async function sendFirmMessageAction(
  channelId: string,
  body: string,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const user = await requireUser();
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Message cannot be empty.' };
  if (trimmed.length > 4000) return { ok: false, error: 'Message is too long (4000 char max).' };
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_messages')
    .insert({
      channel_id: channelId,
      user_id: user.id,
      body: trimmed,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  // Touch last_read_at on the sender's membership row so they don't
  // see their own message as unread.
  await supabase
    .from('firm_channel_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('user_id', user.id);
  return { ok: true, messageId: (data as { id: string }).id };
}

export async function createFirmChannelAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; channelId?: string }> {
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const topic = String(formData.get('topic') ?? '').trim() || null;
  if (!name) return { ok: false, error: 'Name is required.' };
  const supabase = createServerSupabase();
  const { data: ch, error } = await supabase
    .from('firm_channels')
    .insert({
      firm_id: firmId,
      name,
      topic,
      kind: 'channel',
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  // Add creator as a member.
  await supabase.from('firm_channel_members').insert({
    channel_id: (ch as { id: string }).id,
    user_id: user.id,
  });
  revalidatePath('/counsel/chat');
  return { ok: true, channelId: (ch as { id: string }).id };
}

// =====================================================================
// Counsel access requests + grants (invitation-only Counsel signup)
// =====================================================================

export type RequestCounselAccessResult = {
  ok: boolean;
  error?: string;
};

/**
 * Public action - the /counsel/request page is reachable without
 * auth. Creates a firm_access_requests row through the admin client
 * (service role) and emails the Advottic team. The team manually
 * reviews + approves; approval calls approveCounselAccessRequestAction
 * which mints a grant token and emails it to the applicant.
 */
export async function requestCounselAccessAction(
  formData: FormData,
): Promise<RequestCounselAccessResult> {
  const organizationName = String(formData.get('organizationName') ?? '').trim();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim().toLowerCase();
  const contactRole = String(formData.get('contactRole') ?? '').trim() || null;
  const firmTypeRaw = String(formData.get('firmType') ?? 'firm');
  const firmType = (FIRM_TYPES.includes(firmTypeRaw as FirmType)
    ? firmTypeRaw
    : 'firm') as FirmType;
  const teamSize = String(formData.get('teamSize') ?? '').trim() || null;
  const jurisdictions = String(formData.get('jurisdictions') ?? '').trim() || null;
  const description = String(formData.get('description') ?? '').trim() || null;
  if (!organizationName) return { ok: false, error: 'Organization name is required.' };
  if (!contactName) return { ok: false, error: 'Your name is required.' };
  if (!contactEmail || !contactEmail.includes('@')) {
    return { ok: false, error: 'Enter a valid email.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };

  const { error } = await admin.from('firm_access_requests').insert({
    organization_name: organizationName,
    contact_name: contactName,
    contact_email: contactEmail,
    contact_role: contactRole,
    firm_type: firmType,
    team_size: teamSize,
    jurisdictions,
    description,
  });
  if (error) return { ok: false, error: error.message };

  // Notify the Advottic team. Best-effort.
  await sendEmail({
    to: process.env.ADMIN_NOTIFY_TO?.trim() || 'contact@advottic.com',
    subject: `[Counsel] Access request: ${organizationName}`,
    html: `
      <p><strong>${escapeHtml(organizationName)}</strong> has requested Advottic Counsel access.</p>
      <ul>
        <li>Contact: ${escapeHtml(contactName)} &lt;${escapeHtml(contactEmail)}&gt;</li>
        ${contactRole ? `<li>Role: ${escapeHtml(contactRole)}</li>` : ''}
        <li>Type: ${escapeHtml(firmType)}</li>
        ${teamSize ? `<li>Team size: ${escapeHtml(teamSize)}</li>` : ''}
        ${jurisdictions ? `<li>Jurisdictions: ${escapeHtml(jurisdictions)}</li>` : ''}
      </ul>
      ${description ? `<p>${escapeHtml(description).replace(/\n/g, '<br/>')}</p>` : ''}
      <p><a href="${(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://www.advottic.com')}/admin/counsel-requests">Review in admin dashboard</a></p>
    `,
    text: `${organizationName} has requested Advottic Counsel access.\n\nContact: ${contactName} <${contactEmail}>\nType: ${firmType}\n${description ? '\n' + description : ''}\n\nReview: ${(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://www.advottic.com')}/admin/counsel-requests`,
  }).catch(() => {});

  // Confirmation email to the applicant.
  await sendEmail({
    to: contactEmail,
    subject: 'We received your Advottic Counsel request',
    html: `
      <p>Thanks for reaching out about Advottic Counsel for <strong>${escapeHtml(organizationName)}</strong>.</p>
      <p>The Advottic team reviews every request personally - usually within one business day. If approved, we'll email you a single-use link to set up your workspace. The link will be sent to this email address.</p>
      <p>If you have any questions in the meantime, reply to this email.</p>
      <p>- Advottic</p>
    `,
    text: `Thanks for reaching out about Advottic Counsel for ${organizationName}.\n\nThe Advottic team reviews every request personally - usually within one business day. If approved, we'll email you a single-use link to set up your workspace.\n\n- Advottic`,
  }).catch(() => {});

  return { ok: true };
}

/**
 * Admin-only. Approves a request, mints a grant, sends the
 * applicant a single-use signup link.
 */
export async function approveCounselAccessRequestAction(
  requestId: string,
): Promise<{ ok: boolean; error?: string; grantToken?: string }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  // Confirm the caller is an admin.
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !(profile as { is_admin: boolean }).is_admin) {
    return { ok: false, error: 'Admin access required.' };
  }
  const { data: req } = await admin
    .from('firm_access_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: 'Request not found.' };
  const r = req as {
    id: string;
    organization_name: string;
    contact_email: string;
    firm_type: FirmType;
    status: string;
  };
  if (r.status !== 'pending') {
    return { ok: false, error: `Request is already ${r.status}.` };
  }
  const token = newToken(48);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const { error: insertErr } = await admin.from('firm_access_grants').insert({
    request_id: r.id,
    email: r.contact_email.toLowerCase(),
    organization_name: r.organization_name,
    firm_type: r.firm_type,
    token,
    expires_at: expiresAt.toISOString(),
    granted_by: user.id,
  });
  if (insertErr) return { ok: false, error: insertErr.message };
  await admin
    .from('firm_access_requests')
    .update({
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', r.id);

  const url =
    (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://www.advottic.com') +
    `/counsel/welcome?grant=${encodeURIComponent(token)}`;
  await sendEmail({
    to: r.contact_email,
    subject: `Your Advottic Counsel access is ready - ${r.organization_name}`,
    html: `
      <p>Welcome to Advottic Counsel, ${escapeHtml(r.organization_name)}.</p>
      <p>Your single-use setup link is below. Sign in with <strong>${escapeHtml(r.contact_email)}</strong> when prompted.</p>
      <p><a href="${escapeHtml(url)}" style="background:#0f2d24;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Set up your workspace</a></p>
      <p>If the button doesn't work, copy this URL into your browser:<br/><span style="font-family:monospace;font-size:13px;">${escapeHtml(url)}</span></p>
      <p>This link is single-use and expires in 14 days.</p>
      <p>- The Advottic team</p>
    `,
    text: `Welcome to Advottic Counsel, ${r.organization_name}.\n\nYour single-use setup link:\n${url}\n\nSign in with ${r.contact_email} when prompted. Link is single-use and expires in 14 days.\n\n- The Advottic team`,
  }).catch(() => {});

  revalidatePath('/admin/counsel-requests');
  return { ok: true, grantToken: token };
}

export async function denyCounselAccessRequestAction(
  requestId: string,
  note: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !(profile as { is_admin: boolean }).is_admin) {
    return { ok: false, error: 'Admin access required.' };
  }
  const { error } = await admin
    .from('firm_access_requests')
    .update({
      status: 'denied',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq('id', requestId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/counsel-requests');
  return { ok: true };
}

/**
 * Validates a grant token + the signed-in user's email match,
 * runs the original createFirmAction logic, and marks the grant
 * accepted. Used by the token-gated /counsel/welcome onboarding
 * flow.
 */
export async function createFirmFromGrantAction(
  formData: FormData,
): Promise<CreateFirmResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!user.email) return { ok: false, error: 'Your account has no email.' };
  const grantToken = String(formData.get('grant') ?? '').trim();
  if (!grantToken) {
    return { ok: false, error: 'Missing grant token. Use the link from your invitation email.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  const { data: grantRow } = await admin
    .from('firm_access_grants')
    .select('*')
    .eq('token', grantToken)
    .maybeSingle();
  if (!grantRow) return { ok: false, error: 'Grant not found or already used.' };
  const grant = grantRow as {
    id: string;
    email: string;
    organization_name: string;
    firm_type: FirmType;
    expires_at: string;
    accepted_at: string | null;
  };
  if (grant.accepted_at) return { ok: false, error: 'This grant has already been used.' };
  if (Date.parse(grant.expires_at) < Date.now()) {
    return { ok: false, error: 'This grant has expired. Contact the Advottic team for a new one.' };
  }
  if (grant.email.toLowerCase() !== user.email.toLowerCase()) {
    return {
      ok: false,
      error: `This grant was issued to ${grant.email}. Sign in with that email to redeem it.`,
    };
  }
  // Reuse the existing onboarding payload by injecting validated
  // pre-fills and delegating to createFirmAction. We cannot literally
  // call createFirmAction here because it doesn't take a grant token,
  // so we replicate its body inline + clean up the grant.
  const fakeFormData = new FormData();
  for (const [k, v] of formData.entries()) fakeFormData.set(k, v);
  // Force the firm_type from the grant if not explicitly overridden.
  if (!fakeFormData.get('firmType')) fakeFormData.set('firmType', grant.firm_type);
  if (!fakeFormData.get('name')) fakeFormData.set('name', grant.organization_name);
  const result = await createFirmAction(fakeFormData);
  if (!result.ok || !result.firmId) return result;
  // Mark grant as accepted, link to the new firm.
  await admin
    .from('firm_access_grants')
    .update({ accepted_at: new Date().toISOString(), firm_id: result.firmId })
    .eq('id', grant.id);
  // Update the parent request status if any.
  await admin
    .from('firm_access_requests')
    .update({ status: 'accepted' })
    .eq('contact_email', grant.email.toLowerCase())
    .eq('status', 'approved');
  return result;
}

// =====================================================================
// Helpers
// =====================================================================

function parseList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Marker so we can inspect at runtime whether the redirect helper is
// being treated as a side effect. Used by smoke tests.
export async function _firmActionsLoaded(): Promise<true> {
  return true;
}
