'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser, requireUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import {
  callerHasFirmRole,
  callerIsFirmAdmin,
  callerIsFirmMember,
  requireActiveFirm,
  FIRM_MANAGE_ROLES,
} from './firm-authz';
import {
  sendEmail,
  buildMeetingInviteEmailHtml,
  buildSigningRequestEmailHtml,
  buildSigningCodeEmailHtml,
} from './email';
import { seatCheck } from './firm-access';
import type { FirmRole, FirmSigningStatus, FirmType } from './firm-types';
import { FIRM_ROLES, FIRM_TYPES } from './firm-types';
import { CASE_TYPES, type CaseType, type Posture } from './types';
import type {
  Collaborator,
  CollaboratorRole,
  SubjectProfile,
  SubjectType,
} from './types';
import {
  inviteCollaboratorAsFirm,
  listCollaboratorsAsFirm,
  removeCollaboratorAsFirm,
} from './storage';
import { logSecurityEvent } from './security-audit';
import {
  readPortalRoles,
  sanitizeFeatures,
  type PortalRole,
} from './portal-features';
import { PORTAL_PREVIEW_COOKIE } from './persona';
import { readMenuConfig, type MenuConfig } from './menu-config';
import {
  readRequestFolders,
  slugifyFolderKey,
} from './request-folders';
import { scheduleFirmMeeting } from './firm-meetings';

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

/**
 * A 6-character one-time access code for external signers (#5), drawn
 * from an unambiguous alphabet (no 0/O/1/I/L, no vowels to avoid
 * accidental words) so it's easy to read off a phone and hard to
 * mistype. Generated with crypto.randomInt for uniform, unbiased
 * selection. The plaintext is emailed to the signer; only its
 * SHA-256 hash is persisted.
 */
const ACCESS_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';
function newAccessCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ACCESS_CODE_ALPHABET[crypto.randomInt(ACCESS_CODE_ALPHABET.length)];
  }
  return out;
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

  // Phase 2 white-label auto-provisioning. When the env flag is set
  // (default ON for new firms in production) AND Vercel API
  // credentials are configured, every newly-created firm gets its
  // tenant subdomain registered automatically. Best-effort - if the
  // Vercel call fails the firm still exists and an HQ operator can
  // flip the toggle manually from /admin/firms later. We do NOT fail
  // the firm-creation flow on a provisioning hiccup because the firm
  // can still operate at enterprise.advottic.com without a vanity URL.
  const autoProvision =
    (process.env.NEXT_PUBLIC_AUTO_PROVISION_TENANT_SUBDOMAIN ?? '1').trim() !==
    '0';
  if (autoProvision) {
    try {
      const [{ addProjectDomain, isVercelApiConfigured }, { invalidateFirmSubdomain }] =
        await Promise.all([import('./vercel'), import('./firm-cache')]);
      if (isVercelApiConfigured()) {
        const hostname = `${firm.slug}.advottic.com`;
        const vercel = await addProjectDomain(hostname);
        if (vercel.ok) {
          await admin
            .from('firms')
            .update({ subdomain_enabled: true })
            .eq('id', firm.id);
          invalidateFirmSubdomain(firm.slug);
        } else {
          console.warn(
            '[createFirmAction] auto-provision skipped: Vercel API rejected domain',
            { hostname, error: vercel.error, status: vercel.status },
          );
        }
      }
    } catch (err) {
      // Never block firm creation. Surface in logs only.
      console.warn(
        '[createFirmAction] auto-provision threw; firm still created',
        err instanceof Error ? err.message : err,
      );
    }
  }

  revalidatePath('/counsel');
  revalidatePath('/admin/firms');
  return { ok: true, firmId: firm.id, slug: firm.slug };
}

export async function updateFirmAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const name = String(formData.get('name') ?? '').trim();
  const accentColor = String(formData.get('accentColor') ?? '').trim();
  const jurisdictions = parseList(String(formData.get('jurisdictions') ?? ''));
  const practiceAreas = parseList(String(formData.get('practiceAreas') ?? ''));
  const brandName =
    String(formData.get('brandName') ?? '').trim().slice(0, 48) ||
    'Advottic Enterprise';
  const portalTagline = String(formData.get('portalTagline') ?? '')
    .trim()
    .slice(0, 160);
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    return { ok: false, error: 'Accent color must be a 7-character hex like #0f2d24.' };
  }
  const supabase = createServerSupabase();
  // Logo is managed by the dedicated upload action now, so we read
  // the firm's CURRENT logo here (don't clobber it) and gate the
  // hide-Advottic-logo toggle on actually having one.
  const { data: existing } = await supabase
    .from('firms')
    .select('metadata, logo_url')
    .eq('id', firmId)
    .maybeSingle();
  const hasLogo = Boolean(
    (existing as { logo_url?: string | null } | null)?.logo_url,
  );
  const hideAdvotticLogo =
    hasLogo && String(formData.get('hideAdvotticLogo') ?? '') === 'on';
  // Merge into the loose metadata bag rather than clobbering it -
  // onboarding stores firm-type answers in the same column.
  const metadata = {
    ...(((existing as { metadata?: Record<string, unknown> } | null)
      ?.metadata) ?? {}),
    hideAdvotticLogo,
    brandName,
    portalTagline,
  };
  // RLS gates this - only owner/admin can update.
  const { error } = await supabase
    .from('firms')
    .update({
      name,
      accent_color: accentColor,
      jurisdictions,
      practice_areas: practiceAreas,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

const LOGO_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

export async function uploadFirmLogoAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; url?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change the logo.' };
  }
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose an image file.' };
  }
  if (file.size > 3 * 1024 * 1024) {
    return { ok: false, error: 'Image must be under 3 MB.' };
  }
  if (!LOGO_MIME.has(file.type)) {
    return {
      ok: false,
      error: 'Use a PNG, JPG, WebP, or SVG image.',
    };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const ext =
    file.type === 'image/svg+xml'
      ? 'svg'
      : file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : 'jpg';
  const path = `${firmId}/logo-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from('firm-branding')
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (upErr) return { ok: false, error: upErr.message };
  const {
    data: { publicUrl },
  } = admin.storage.from('firm-branding').getPublicUrl(path);
  const { error } = await admin
    .from('firms')
    .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true, url: publicUrl };
}

export async function removeFirmLogoAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change the logo.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  // Clearing the logo also disables the white-label toggle (no logo
  // = the header must keep the Advottic mark for identity).
  const { data: cur } = await admin
    .from('firms')
    .select('metadata')
    .eq('id', firmId)
    .maybeSingle();
  const md = {
    ...(((cur as { metadata?: Record<string, unknown> } | null)
      ?.metadata) ?? {}),
    hideAdvotticLogo: false,
  };
  const { error } = await admin
    .from('firms')
    .update({
      logo_url: null,
      metadata: md,
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

// Letterhead is a separate asset from the small logo: it's the full-
// width band painted across the top of any PDF Bella renders for the
// firm (return address, phone, partner names, bar IDs, etc). Same
// bucket as the logo since the access pattern is identical (publicly
// readable so the PDF generator can fetch it without auth round-
// trips), but the upload limit is bigger because letterheads are
// usually high-resolution scans the firm wants printed at 300 DPI.
const LETTERHEAD_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export async function uploadFirmLetterheadAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; url?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return {
      ok: false,
      error: 'Only an owner or admin can change the letterhead.',
    };
  }
  const file = formData.get('letterhead');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose an image file.' };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, error: 'Image must be under 8 MB.' };
  }
  if (!LETTERHEAD_MIME.has(file.type)) {
    // No SVG - pdf-lib can't embed SVG without a rasteriser step
    // and we want the letterhead to render verbatim. The web PNG
    // editor most lawyers have already produces a flat raster
    // anyway.
    return { ok: false, error: 'Use a PNG, JPG, or WebP image.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : 'jpg';
  const path = `${firmId}/letterhead-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from('firm-branding')
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (upErr) return { ok: false, error: upErr.message };
  const {
    data: { publicUrl },
  } = admin.storage.from('firm-branding').getPublicUrl(path);
  const { error } = await admin
    .from('firms')
    .update({
      letterhead_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true, url: publicUrl };
}

export async function removeFirmLetterheadAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return {
      ok: false,
      error: 'Only an owner or admin can change the letterhead.',
    };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const { error } = await admin
    .from('firms')
    .update({
      letterhead_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
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
  // Defense in depth: the firm_invitations RLS insert policy already
  // requires an owner/admin, but check in-code too so authorization
  // never rests on a single (untracked) policy - and so we return a
  // clean error instead of a raw RLS violation.
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only firm owners and admins can invite members.' };
  }
  // The gate, not the redirect. This export is a public HTTP endpoint and
  // stays callable after the shell has sent this person to the access-ended
  // page. There is deliberately no try around it: firmTrialState throws when
  // access cannot be determined, and that is a refusal, not a reason to
  // continue.
  await requireActiveFirm(firmId);
  const supabase = createServerSupabase();
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
    (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com') +
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
  // Nobody joins an organization whose access has ended, and the invitee is
  // not a member yet, so this is the only check that can say so.
  await requireActiveFirm(invRow.firm_id);

  // Seat cap. This is the point where a seat is actually CONSUMED, so it is
  // the point that has to refuse: an invitation is only an offer, and the
  // number of outstanding offers is not the number of people in the firm.
  //
  // Existing members are grandfathered. seatCheck is never used to remove
  // anybody, so an organization whose limit was lowered below its headcount
  // keeps everyone it has and simply cannot add the next person. A member
  // re-accepting an invitation they already used consumes no seat either,
  // which is why the caller is excluded from the count rather than refused at
  // a full limit they are already inside.
  const { data: seatRows, error: seatErr } = await admin
    .from('firm_members')
    .select('user_id')
    .eq('firm_id', invRow.firm_id);
  const { data: seatFirm, error: seatFirmErr } = await admin
    .from('firms')
    .select('seat_limit')
    .eq('id', invRow.firm_id)
    .maybeSingle();
  if (seatErr || seatFirmErr) {
    console.error(
      'acceptFirmInvitationAction: could not read the seat count',
      seatErr?.message ?? seatFirmErr?.message,
    );
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  const members = (seatRows ?? []) as Array<{ user_id: string }>;
  const alreadyAMember = members.some((m) => m.user_id === user.id);
  const seatLimit = (seatFirm as { seat_limit: number | null } | null)?.seat_limit ?? null;
  if (!alreadyAMember) {
    const seats = seatCheck({ seatLimit, currentMembers: members.length });
    if (!seats.ok) {
      return {
        ok: false,
        error: `This organization has reached its limit of ${seatLimit} members. An owner or an administrator can raise it.`,
      };
    }
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
  // The firm's `created_by` is the paying subscriber every other
  // member's entitlement resolves against (see assertOrganizerEligible
  // in lib/community-actions.ts and getSubscriptionForUser). RLS allows
  // an owner/admin to remove any member including the owner, and the
  // owner to remove themselves - either path used to leave `created_by`
  // pointing at someone no longer in the firm, with no way to reassign
  // it. Block it here; ownership must move via transferFirmOwnershipAction
  // first, which keeps `created_by` and the 'owner' role in sync.
  const { data: memberRow } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', memberUserId)
    .maybeSingle();
  if ((memberRow as { role: FirmRole } | null)?.role === 'owner') {
    return {
      ok: false,
      error:
        'This person owns the firm and can’t be removed. Transfer ownership to another member first.',
    };
  }
  const { error } = await supabase
    .from('firm_members')
    .delete()
    .eq('firm_id', firmId)
    .eq('user_id', memberUserId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/team');
  return { ok: true };
}

/**
 * Transfers firm ownership (billing identity) from the current owner to
 * another existing firm member. This is the only sanctioned way
 * `firms.created_by` changes after firm creation - keeps it and the
 * 'owner' `firm_members.role` in sync so removeFirmMemberAction's guard
 * above and every subscription-resolution call site stay correct.
 *
 * Only the CURRENT owner may initiate a transfer (not just any admin) -
 * this is a billing-identity change, not a routine role edit.
 */
export async function transferFirmOwnershipAction(
  firmId: string,
  newOwnerUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  if (user.id === newOwnerUserId) {
    return { ok: false, error: 'You already own this firm.' };
  }

  const { data: callerRow } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if ((callerRow as { role: FirmRole } | null)?.role !== 'owner') {
    return { ok: false, error: 'Only the current firm owner can transfer ownership.' };
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  }
  const { data: targetRow } = await admin
    .from('firm_members')
    .select('user_id')
    .eq('firm_id', firmId)
    .eq('user_id', newOwnerUserId)
    .maybeSingle();
  if (!targetRow) {
    return { ok: false, error: 'That person is not a member of this firm.' };
  }

  const { error: firmErr } = await admin
    .from('firms')
    .update({ created_by: newOwnerUserId })
    .eq('id', firmId);
  if (firmErr) return { ok: false, error: firmErr.message };

  const { error: demoteErr } = await admin
    .from('firm_members')
    .update({ role: 'admin' as FirmRole })
    .eq('firm_id', firmId)
    .eq('user_id', user.id);
  if (demoteErr) return { ok: false, error: demoteErr.message };

  const { error: promoteErr } = await admin
    .from('firm_members')
    .update({ role: 'owner' as FirmRole })
    .eq('firm_id', firmId)
    .eq('user_id', newOwnerUserId);
  if (promoteErr) return { ok: false, error: promoteErr.message };

  try {
    const h = headers();
    await logSecurityEvent({
      kind: 'role_changed',
      userId: user.id,
      ip: (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
      userAgent: h.get('user-agent'),
      details: {
        firm_id: firmId,
        event: 'ownership_transferred',
        previous_owner_id: user.id,
        new_owner_id: newOwnerUserId,
      },
    });
  } catch {
    /* best-effort audit */
  }

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
  // 'owner' is tied to firms.created_by (the paying subscriber) and may
  // only change via transferFirmOwnershipAction, which keeps both in
  // sync. Reject both directions here: granting 'owner' through this
  // generic editor would create a second owner without touching
  // created_by, and demoting the current owner away from 'owner' would
  // leave created_by pointing at someone no longer marked as owner.
  if (newRole === 'owner') {
    return { ok: false, error: 'Use "Transfer ownership" to change the firm owner.' };
  }
  const { data: currentRow } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', memberUserId)
    .maybeSingle();
  if ((currentRow as { role: FirmRole } | null)?.role === 'owner') {
    return {
      ok: false,
      error: 'This person owns the firm. Transfer ownership to someone else before changing their role.',
    };
  }
  const { error } = await supabase
    .from('firm_members')
    .update({ role: newRole })
    .eq('firm_id', firmId)
    .eq('user_id', memberUserId);
  if (error) return { ok: false, error: error.message };
  // Audit the permission change (HIPAA 164.308(a)(4) access management).
  try {
    const h = headers();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logSecurityEvent({
      kind: 'role_changed',
      userId: user?.id ?? null,
      ip: (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
      userAgent: h.get('user-agent'),
      details: {
        firm_id: firmId,
        target_user_id: memberUserId,
        new_role: newRole,
        actor_email: user?.email ?? null,
      },
    });
  } catch {
    /* best-effort audit */
  }
  revalidatePath('/counsel/team');
  return { ok: true };
}

// =====================================================================
// Enterprise employees (the non-legal /portal population)
// =====================================================================
//
// firm_employees has RLS with NO write policy and only a self-select
// policy (see supabase/fixes/2026-05-18-firm-employees.sql), so every
// action here MUST (a) gate the caller as owner/admin by hand and
// (b) use the service-role client to write. See
// docs/ENTERPRISE_WORKSPACE.md.

export type FirmEmployeeListItem = {
  id: string;
  email: string;
  displayName: string | null;
  department: string | null;
  source: string;
  linked: boolean;
  roleKey: string | null;
  deactivatedAt: string | null;
  createdAt: string;
};

// callerIsFirmMember / callerIsFirmAdmin / callerHasFirmRole now live in
// lib/firm-authz.ts so every module that gates on a caller-supplied firmId
// uses the same check. They are imported at the top of this file.

export async function addFirmEmployeeAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can add employees.' };
  }
  // The twin of inviteFirmMemberAction. Gating one route into an organization
  // and leaving the other open gates nothing: this is how a Hub employee is
  // added, and it writes firm_employees through the admin client.
  //
  // No seat check here, deliberately. A firm_employees row is not a
  // firm_members seat: it is a person the organization's Hub knows about, and
  // seatCheck is called where a seat is actually consumed, at the
  // firm_members insert in acceptFirmInvitationAction.
  await requireActiveFirm(firmId);
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const displayName = String(formData.get('displayName') ?? '').trim() || null;
  const department = String(formData.get('department') ?? '').trim() || null;
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Enter a valid email.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  // Upsert on (firm_id, email): re-adding a deactivated person
  // reactivates them rather than erroring on the unique constraint.
  const { error } = await admin
    .from('firm_employees')
    .upsert(
      {
        firm_id: firmId,
        email,
        display_name: displayName,
        department,
        source: 'manual',
        deactivated_at: null,
      },
      { onConflict: 'firm_id,email' },
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/team');
  return { ok: true };
}

export async function listFirmEmployeesAction(
  firmId: string,
): Promise<FirmEmployeeListItem[]> {
  if (!(await callerIsFirmAdmin(firmId))) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data } = await admin
    .from('firm_employees')
    .select(
      'id, email, display_name, department, source, user_id, role_key, deactivated_at, created_at',
    )
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(500);
  return ((data ?? []) as Array<{
    id: string;
    email: string;
    display_name: string | null;
    department: string | null;
    source: string;
    user_id: string | null;
    role_key: string | null;
    deactivated_at: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    department: r.department,
    source: r.source,
    linked: r.user_id !== null,
    roleKey: r.role_key ?? null,
    deactivatedAt: r.deactivated_at,
    createdAt: r.created_at,
  }));
}

/**
 * Read-only employee directory, visible to any legal-team member (not
 * just admins - the management panel's write actions stay admin-gated
 * separately). Powers the /counsel/employees directory page.
 */
export async function listFirmEmployeeDirectory(
  firmId: string,
): Promise<FirmEmployeeListItem[]> {
  if (!(await callerIsFirmMember(firmId))) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data } = await admin
    .from('firm_employees')
    .select(
      'id, email, display_name, department, source, user_id, role_key, deactivated_at, created_at',
    )
    .eq('firm_id', firmId)
    .order('display_name', { ascending: true, nullsFirst: false })
    .limit(1000);
  return ((data ?? []) as Array<{
    id: string;
    email: string;
    display_name: string | null;
    department: string | null;
    source: string;
    user_id: string | null;
    role_key: string | null;
    deactivated_at: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    department: r.department,
    source: r.source,
    linked: r.user_id !== null,
    roleKey: r.role_key ?? null,
    deactivatedAt: r.deactivated_at,
    createdAt: r.created_at,
  }));
}

export async function setFirmEmployeeActiveAction(
  firmId: string,
  employeeId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can do that.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const { error } = await admin
    .from('firm_employees')
    .update({ deactivated_at: active ? null : new Date().toISOString() })
    .eq('id', employeeId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  // Audit provisioning changes (HIPAA 164.308(a)(3) workforce security).
  try {
    const h = headers();
    await logSecurityEvent({
      kind: 'employee_deactivated',
      userId: (actor as { id?: string } | null)?.id ?? null,
      ip: (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
      userAgent: h.get('user-agent'),
      details: { firm_id: firmId, employee_id: employeeId, active },
    });
  } catch {
    /* best-effort audit */
  }
  revalidatePath('/counsel/team');
  return { ok: true };
}

// =====================================================================
// Portal roles / groups + employee-portal preview
// =====================================================================
//
// Roles are named feature bundles stored in firms.metadata.portalRoles
// (no schema). An employee is assigned one via firm_employees.role_key.
// resolveEntitlements() (lib/portal-features) turns that into the
// portal's effective capabilities. Preview lets an owner/admin see
// the portal as a role without a second account.

function slugifyRoleKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || `role-${Date.now().toString(36)}`
  );
}

async function readFirmMetadata(
  firmId: string,
): Promise<Record<string, unknown>> {
  const admin = createAdminSupabase();
  if (!admin) return {};
  const { data } = await admin
    .from('firms')
    .select('metadata')
    .eq('id', firmId)
    .maybeSingle();
  return (
    ((data as { metadata?: Record<string, unknown> } | null)?.metadata) ??
    {}
  );
}

export async function listPortalRolesAction(
  firmId: string,
): Promise<PortalRole[]> {
  if (!(await callerIsFirmAdmin(firmId))) return [];
  return readPortalRoles(await readFirmMetadata(firmId));
}

export async function savePortalRoleAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can manage roles.' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Give the role a name.' };
  // Editing keeps the original key; new roles slugify the name.
  const existingKey = String(formData.get('key') ?? '').trim();
  const key = existingKey || slugifyRoleKey(name);
  const features = sanitizeFeatures(formData.getAll('feature'));

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const metadata = await readFirmMetadata(firmId);
  const roles = readPortalRoles(metadata);
  const next = roles.filter((r) => r.key !== key);
  next.push({ key, name, features });
  const { error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, portalRoles: next },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/team');
  return { ok: true };
}

export async function deletePortalRoleAction(
  firmId: string,
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can manage roles.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const metadata = await readFirmMetadata(firmId);
  const roles = readPortalRoles(metadata).filter((r) => r.key !== key);
  const { error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, portalRoles: roles },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  // Unassign anyone who had it (they fall back to default access).
  await admin
    .from('firm_employees')
    .update({ role_key: null })
    .eq('firm_id', firmId)
    .eq('role_key', key);
  revalidatePath('/counsel/team');
  return { ok: true };
}

export async function setFirmEmployeeRoleAction(
  firmId: string,
  employeeId: string,
  roleKey: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can do that.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const { error } = await admin
    .from('firm_employees')
    .update({ role_key: roleKey || null })
    .eq('id', employeeId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/team');
  return { ok: true };
}

// --- Employee-portal preview (owner/admin only) ----------------------

export async function enterPortalPreviewAction(
  firmId: string,
  roleKey: string,
  // 'employee' (default) previews the in-house Hub with the given
  // portal role; 'vendor' previews the external-collaborator view.
  // Optional + defaulted so existing 2-arg callers keep working.
  mode: 'employee' | 'vendor' = 'employee',
): Promise<void> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    redirect('/counsel');
  }
  const safeMode = mode === 'vendor' ? 'vendor' : 'employee';
  cookies().set(
    PORTAL_PREVIEW_COOKIE,
    JSON.stringify({ firmId, roleKey: roleKey || '', mode: safeMode }),
    {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1h - a preview, not a session
    },
  );
  redirect('/portal');
}

export async function exitPortalPreviewAction(): Promise<void> {
  cookies().delete(PORTAL_PREVIEW_COOKIE);
  redirect('/counsel');
}

// =====================================================================
// Counsel sidebar customization (hide / rename / reorder)
// =====================================================================

export async function saveMenuConfigAction(
  firmId: string,
  config: MenuConfig,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can edit the menu.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  // Sanitize through the same defensive parser the sidebar uses, so
  // a hand-crafted payload can never inject unknown hrefs/sections.
  const clean = readMenuConfig({ menuConfig: config });
  const metadata = await readFirmMetadata(firmId);
  const { error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, menuConfig: clean },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

export async function resetMenuConfigAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can edit the menu.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const metadata = await readFirmMetadata(firmId);
  const next = { ...metadata };
  delete (next as Record<string, unknown>).menuConfig;
  const { error } = await admin
    .from('firms')
    .update({ metadata: next, updated_at: new Date().toISOString() })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

// =====================================================================
// Request folders / segmentation
// =====================================================================

export async function saveRequestFolderAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can manage folders.' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name the folder.' };
  const existingKey = String(formData.get('key') ?? '').trim();
  const key = existingKey || slugifyFolderKey(name);
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const metadata = await readFirmMetadata(firmId);
  const folders = readRequestFolders(metadata).filter((f) => f.key !== key);
  folders.push({ key, name });
  const { error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, requestFolders: folders },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/intake');
  return { ok: true };
}

export async function deleteRequestFolderAction(
  firmId: string,
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can manage folders.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const metadata = await readFirmMetadata(firmId);
  const folders = readRequestFolders(metadata).filter((f) => f.key !== key);
  const { error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, requestFolders: folders },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  // Intakes that pointed here simply read back as "Unfiled" (the
  // lookup misses) - no bulk JSON rewrite needed.
  revalidatePath('/counsel/intake');
  return { ok: true };
}

export async function setIntakeReminderAction(
  firmId: string,
  intakeId: string,
  reminderISO: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const { data: row } = await admin
    .from('firm_matter_intakes')
    .select('intake_answers, firm_id')
    .eq('id', intakeId)
    .maybeSingle();
  const r = row as {
    intake_answers: Record<string, unknown> | null;
    firm_id: string;
  } | null;
  if (!r || r.firm_id !== firmId) {
    return { ok: false, error: 'Request not found.' };
  }
  const ans = { ...(r.intake_answers ?? {}) };
  if (reminderISO) {
    const ms = Date.parse(reminderISO);
    if (Number.isNaN(ms)) return { ok: false, error: 'Invalid date.' };
    ans.reminder_at = new Date(ms).toISOString();
    ans.reminder_fired = false;
  } else {
    delete ans.reminder_at;
    delete ans.reminder_fired;
  }
  const { error } = await admin
    .from('firm_matter_intakes')
    .update({ intake_answers: ans, updated_at: new Date().toISOString() })
    .eq('id', intakeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/intake/${intakeId}`);
  return { ok: true };
}

/**
 * Convert an accepted intake/request into a firm case (Product H1 fix).
 *
 * Intake used to be a terminal inbox: the only actions were set-reminder
 * and schedule-a-meeting, so an accepted matter never became a case -
 * the lifecycle had an entrance but no exit into the caseload. This
 * writes a firm-scoped `cases` row from the intake fields, links it back
 * (firm_matter_intakes.case_id), and flips the intake to 'converted'.
 * Idempotent: a second call returns the already-linked case.
 *
 * Runs via the admin client because it sets cases.firm_id (which the
 * consumer RLS write policy would reject); the caller is verified as a
 * posting-role member of the firm first.
 */
export async function convertIntakeToCaseAction(
  firmId: string,
  intakeId: string,
): Promise<{ ok: boolean; error?: string; caseId?: string }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  // AuthZ: posting-role member of this firm (not read-only staff).
  const supabase = createServerSupabase();
  const { data: mem } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (mem as { role?: string } | null)?.role;
  if (!role || !['owner', 'admin', 'attorney', 'paralegal'].includes(role)) {
    return { ok: false, error: 'You do not have permission to open a matter.' };
  }
  // The OTHER way a matter gets created. createFirmCaseAction is gated, and
  // gating one of a pair while its twin stays open enforces nothing: an
  // organization whose access ended could keep opening matters straight off
  // its intake queue.
  await requireActiveFirm(firmId);

  const { data: row } = await admin
    .from('firm_matter_intakes')
    .select(
      'firm_id, case_id, client_name, matter_type, matter_summary, jurisdiction_state',
    )
    .eq('id', intakeId)
    .maybeSingle();
  const intake = row as {
    firm_id: string;
    case_id: string | null;
    client_name: string | null;
    matter_type: string | null;
    matter_summary: string | null;
    jurisdiction_state: string | null;
  } | null;
  if (!intake || intake.firm_id !== firmId) {
    return { ok: false, error: 'Request not found.' };
  }
  // Idempotent: already converted.
  if (intake.case_id) return { ok: true, caseId: intake.case_id };

  const title =
    (intake.matter_type || '').trim() ||
    (intake.client_name ? `${intake.client_name} matter` : '') ||
    'New matter';

  const { data: created, error: caseErr } = await admin
    .from('cases')
    .insert({
      firm_id: firmId,
      user_id: user.id,
      title,
      subject_name: (intake.client_name || title).trim(),
      subject_type: 'person',
      case_type: (intake.matter_type || 'other').trim() || 'other',
      status: 'open',
      posture: 'claimant',
      description: intake.matter_summary || '',
      jurisdiction_country: 'US',
      jurisdiction_state: intake.jurisdiction_state || '',
      jurisdiction_city: '',
      sandbox: false,
    })
    .select('id')
    .single();
  if (caseErr || !created) {
    return { ok: false, error: caseErr?.message ?? 'Could not open the matter.' };
  }
  const caseId = (created as { id: string }).id;

  // Never let this fail silently: if the intake cannot be marked converted,
  // the partner webhook announces a stale status and the companion app shows
  // the request stuck forever (this exact bug shipped once, via a status
  // CHECK constraint that predated the partner lifecycle).
  const { error: convErr } = await admin
    .from('firm_matter_intakes')
    .update({
      case_id: caseId,
      status: 'converted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', intakeId);
  if (convErr) {
    console.error('intake convert update failed:', convErr.message);
    return { ok: false, error: `Matter created, but the request could not be marked converted: ${convErr.message}` };
  }

  // Partner-born tickets: tell the partner app (webhook) and the
  // employee (email) that their request became a matter. Best-effort.
  try {
    const { partnerTicketEvent } = await import('./partner-notify');
    await partnerTicketEvent(intakeId, 'ticket.status_changed');
  } catch {
    /* best-effort */
  }

  revalidatePath(`/counsel/intake/${intakeId}`);
  revalidatePath('/counsel/cases');
  return { ok: true, caseId };
}

// =====================================================================
// Schedule a Teams/Zoom meeting from a request
// =====================================================================

export async function scheduleMeetingFromIntakeAction(
  firmId: string,
  intakeId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; joinUrl?: string }> {
  const user = await requireUser();
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const startISO = String(formData.get('startISO') ?? '').trim();
  const durationMin = Math.min(
    240,
    Math.max(15, Number(formData.get('durationMin') ?? 30) || 30),
  );
  const startMs = Date.parse(startISO);
  if (!startISO || Number.isNaN(startMs)) {
    return { ok: false, error: 'Pick a valid date and time.' };
  }
  if (startMs < Date.now() - 60_000) {
    return { ok: false, error: 'Pick a time in the future.' };
  }

  const { data: row } = await admin
    .from('firm_matter_intakes')
    .select('firm_id, created_by, client_name, intake_answers')
    .eq('id', intakeId)
    .maybeSingle();
  const intake = row as {
    firm_id: string;
    created_by: string | null;
    client_name: string;
    intake_answers: Record<string, unknown> | null;
  } | null;
  if (!intake || intake.firm_id !== firmId) {
    return { ok: false, error: 'Request not found.' };
  }

  const title =
    String(formData.get('title') ?? '').trim() ||
    `Advottic: ${intake.client_name}`;
  const attendees = new Set<string>();
  String(formData.get('attendees') ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'))
    .forEach((a) => attendees.add(a.toLowerCase()));
  if (intake.created_by) {
    const { data: emp } = await admin
      .from('firm_employees')
      .select('email')
      .eq('firm_id', firmId)
      .eq('user_id', intake.created_by)
      .maybeSingle();
    const e = emp as { email?: string } | null;
    if (e?.email) attendees.add(e.email.toLowerCase());
  }

  const result = await scheduleFirmMeeting(firmId, {
    topic: title,
    startISO: new Date(startMs).toISOString(),
    durationMin,
    attendees: [...attendees],
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Persist for the firm calendar (best-effort - the meeting itself
  // is already created in Teams/Zoom + the requester's calendar).
  try {
    await admin.from('firm_meetings').insert({
      firm_id: firmId,
      intake_id: intakeId,
      created_by: user.id,
      provider: result.provider,
      topic: title,
      join_url: result.joinUrl,
      start_at: new Date(startMs).toISOString(),
      duration_min: durationMin,
    });
  } catch {
    /* calendar persistence is best-effort */
  }

  // Post the meeting into the request thread so it lives in the
  // conversation, and notify the requester.
  const { data: mem } = await admin
    .from('firm_members')
    .select('display_name')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const byName =
    (mem as { display_name?: string } | null)?.display_name || 'Legal';
  const when = new Date(startMs).toLocaleString();
  const providerLabel =
    result.provider === 'microsoft' ? 'Microsoft Teams' : 'Zoom';
  const answers = (intake.intake_answers ?? {}) as Record<string, unknown>;
  const thread = Array.isArray(answers.thread)
    ? (answers.thread as unknown[])
    : [];
  const msg = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    byUserId: user.id,
    name: byName,
    role: 'legal' as const,
    at: new Date().toISOString(),
    text: `📅 ${providerLabel} meeting scheduled for ${when} (${durationMin} min).\nJoin: ${result.joinUrl}`,
  };
  await admin
    .from('firm_matter_intakes')
    .update({
      intake_answers: { ...answers, thread: [...thread, msg] },
      updated_at: new Date().toISOString(),
    })
    .eq('id', intakeId);

  if (intake.created_by) {
    try {
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: intake.created_by,
        type: 'meeting_scheduled',
        title: `${providerLabel} meeting scheduled`,
        body: `${when} - join link is in your request.`,
        link: `/portal/${intakeId}`,
        actorUserId: user.id,
      });
    } catch {
      /* best-effort */
    }
  }

  revalidatePath(`/counsel/intake/${intakeId}`);
  revalidatePath(`/portal/${intakeId}`);
  return { ok: true, joinUrl: result.joinUrl };
}

// =====================================================================
// Schedule a standalone meeting from the shared calendar (no request)
// =====================================================================

function gcalStamp(ms: number): string {
  // Google Calendar template wants YYYYMMDDTHHMMSSZ (UTC, no punctuation).
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function scheduleStandaloneMeetingAction(
  firmId: string,
  formData: FormData,
): Promise<{
  ok: boolean;
  error?: string;
  joinUrl?: string;
  provider?: 'microsoft' | 'zoom';
  invited?: number;
}> {
  const user = await requireUser();
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  // This one sends OUTBOUND calendar invitations, to third parties, in
  // Advottic's name and under the organization's. A suspended organization is
  // the abuse-response state, so leaving this open means the response does not
  // stop the behaviour it was invoked for.
  await requireActiveFirm(firmId);
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const topic =
    String(formData.get('title') ?? '').trim() || 'Advottic meeting';
  const startISO = String(formData.get('startISO') ?? '').trim();
  const durationMin = Math.min(
    480,
    Math.max(15, Number(formData.get('durationMin') ?? 30) || 30),
  );
  const startMs = Date.parse(startISO);
  if (!startISO || Number.isNaN(startMs)) {
    return { ok: false, error: 'Pick a valid date and time.' };
  }
  if (startMs < Date.now() - 60_000) {
    return { ok: false, error: 'Pick a time in the future.' };
  }

  const attendees = new Set<string>();
  String(formData.get('attendees') ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@') && s.length <= 254)
    .forEach((a) => attendees.add(a.toLowerCase()));
  if (user.email) attendees.add(user.email.toLowerCase());

  const providerChoice = String(formData.get('provider') ?? 'auto').trim();
  const provider: 'microsoft' | 'zoom' | undefined =
    providerChoice === 'microsoft'
      ? 'microsoft'
      : providerChoice === 'zoom'
        ? 'zoom'
        : undefined;

  const result = await scheduleFirmMeeting(firmId, {
    topic,
    startISO: new Date(startMs).toISOString(),
    durationMin,
    attendees: [...attendees],
    provider,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Persist for the shared calendar (best-effort - the meeting itself
  // already exists in Teams/Zoom + the organizer's calendar).
  try {
    await admin.from('firm_meetings').insert({
      firm_id: firmId,
      intake_id: null,
      created_by: user.id,
      provider: result.provider,
      topic,
      join_url: result.joinUrl,
      start_at: new Date(startMs).toISOString(),
      duration_min: durationMin,
    });
  } catch {
    /* calendar persistence is best-effort */
  }

  // Send the single, firm-branded invite to every attendee. The
  // provider event is created WITHOUT attendees (see firm-meetings),
  // so this is the only invitation that goes out - branded with the
  // firm's name + logo, from the firm.
  const { data: mem } = await admin
    .from('firm_members')
    .select('display_name')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const organizerName =
    (mem as { display_name?: string } | null)?.display_name ||
    user.email ||
    'Advottic';
  // Firm identity for the invite branding + sender name.
  const { data: firmRow } = await admin
    .from('firms')
    .select('name, metadata, logo_url')
    .eq('id', firmId)
    .maybeSingle();
  const fr = firmRow as {
    name?: string;
    metadata?: Record<string, unknown> | null;
    logo_url?: string | null;
  } | null;
  // Prefer a real custom brand name, but the brandName field ships
  // defaulted to "Advottic Enterprise" - that's a generic product
  // label, not the organization. When it's unset or still an Advottic
  // default, identify the invite by the firm's own name (e.g.
  // "Zinpro") so it reads as coming from the organization.
  const rawBrand = String((fr?.metadata ?? {}).brandName ?? '').trim();
  const isAdvotticDefault = /^advottic(\s|$)/i.test(rawBrand);
  const firmName =
    (rawBrand && !isAdvotticDefault ? rawBrand : '') ||
    (fr?.name ?? '').trim() ||
    'Advottic';
  const firmLogoUrl = fr?.logo_url ?? null;
  const providerLabel =
    result.provider === 'microsoft' ? 'Microsoft Teams' : 'Zoom';
  const whenText = new Date(startMs).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const endMs = startMs + durationMin * 60_000;
  const addToCalendarUrl =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(topic)}` +
    `&dates=${gcalStamp(startMs)}/${gcalStamp(endMs)}` +
    `&details=${encodeURIComponent(`Join: ${result.joinUrl}`)}` +
    `&location=${encodeURIComponent(result.joinUrl)}`;
  const html = buildMeetingInviteEmailHtml({
    organizerName,
    topic,
    whenText,
    durationMin,
    providerLabel,
    joinUrl: result.joinUrl,
    addToCalendarUrl,
    firmName,
    logoUrl: firmLogoUrl,
  });
  let invited = 0;
  await Promise.all(
    [...attendees].map(async (to) => {
      const r = await sendEmail({
        to,
        subject: `${firmName}: ${topic} - ${whenText}`,
        html,
        replyTo: user.email ?? undefined,
        fromName: firmName,
      });
      if (r.ok) invited += 1;
    }),
  );

  revalidatePath('/counsel/calendar');
  revalidatePath('/counsel/meetings');
  return {
    ok: true,
    joinUrl: result.joinUrl,
    provider: result.provider,
    invited,
  };
}

export async function setIntakeFolderAction(
  firmId: string,
  intakeId: string,
  folderKey: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  // Any legal-team member can file/triage a request, not just admins.
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const { data: row } = await admin
    .from('firm_matter_intakes')
    .select('intake_answers, firm_id')
    .eq('id', intakeId)
    .maybeSingle();
  const r = row as {
    intake_answers: Record<string, unknown> | null;
    firm_id: string;
  } | null;
  if (!r || r.firm_id !== firmId) {
    return { ok: false, error: 'Request not found.' };
  }
  const answers = { ...(r.intake_answers ?? {}), folder: folderKey || '' };
  const { error } = await admin
    .from('firm_matter_intakes')
    .update({
      intake_answers: answers,
      updated_at: new Date().toISOString(),
    })
    .eq('id', intakeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/intake');
  revalidatePath(`/counsel/intake/${intakeId}`);
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
  // The roster this writes to is the corpus lib/conflict-check.ts searches,
  // and the invitation email below is branded as this firm. Both make an
  // unchecked caller-supplied firmId unacceptable: gate on the same roles the
  // firm_clients insert policy allows (owner, admin, attorney), since the
  // service-role write further down bypasses that policy.
  if (!(await callerHasFirmRole(firmId, FIRM_MANAGE_ROLES))) {
    return {
      ok: false,
      error: 'Only an owner, admin, or attorney at this firm can invite clients.',
    };
  }
  await requireActiveFirm(firmId);
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
        (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com') +
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
    html: `<p>Your attorney's office added you to Advottic so you can share documents, sign agreements, and communicate securely.</p><p>If you already have an Advottic account, <a href="https://advottic.com/sign-in">sign in here</a>. Otherwise, watch for a sign-in link from Advottic.</p>`,
    text: `Your attorney's office added you to Advottic so you can share documents, sign agreements, and communicate securely.\n\nIf you already have an Advottic account, sign in at https://advottic.com/sign-in. Otherwise, watch for a sign-in link from Advottic.`,
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
  const statusRaw = String(formData.get('status') ?? 'submitted').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const dueAtRaw = String(formData.get('dueAt') ?? '').trim();
  const dueAt = dueAtRaw ? new Date(dueAtRaw).toISOString() : null;
  // Whitelist initial status values - the rest are workflow states
  // reached after the document is moving, not at upload time.
  const status = ['received', 'submitted', 'ready'].includes(statusRaw)
    ? statusRaw
    : 'submitted';

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
  await requireActiveFirm(firmId);
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_ ]/g, '').slice(0, 100);
  const filePath = `${firmId}/${id}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  // Magic-byte screen: block HTML/SVG/executables + content-confusion
  // before the bytes land in the private firm-documents bucket.
  // (Audit 2026-07-03, H3.)
  {
    const { screenAuthenticatedUpload } = await import('./upload-safety');
    const screen = screenAuthenticatedUpload(
      buffer,
      file.type || null,
      50 * 1024 * 1024,
    );
    if (!screen.ok) return { ok: false, error: screen.reason };
  }
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
      status,
      description,
      due_at: dueAt,
    })
    .select('id')
    .single();
  if (insertErr || !doc) return { ok: false, error: insertErr?.message ?? 'Insert failed.' };
  revalidatePath('/counsel/documents');
  return { ok: true, documentId: (doc as { id: string }).id };
}

/**
 * Update a document's status and optionally its case linkage,
 * description, and due date. Used by the document detail page's
 * status changer + the firm's signing flow when a request fires
 * an event that should auto-flip the document state (eg. all
 * signers internal -> signed_internal).
 *
 * Allowed status values are checked at the database layer; this
 * action just whitelists the strings client-side so we can return
 * a friendly error instead of letting Postgres reject the row.
 */
const ALLOWED_DOC_STATUSES = new Set([
  'received',
  'submitted',
  'ready',
  'sent',
  'pending',
  'signed_internal',
  'signed_employee',
  'signed_client',
  'signed_other',
  'on_hold',
  'overdue',
  'canceled',
]);

export async function updateFirmDocumentAction(
  firmId: string,
  documentId: string,
  patch: {
    status?: string;
    caseId?: string | null;
    description?: string | null;
    dueAt?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  const role = (member as { role: FirmRole }).role;
  if (!['owner', 'admin', 'attorney', 'paralegal'].includes(role)) {
    return { ok: false, error: 'Your role cannot edit documents.' };
  }

  const updates: Record<string, unknown> = {};
  if (typeof patch.status === 'string') {
    if (!ALLOWED_DOC_STATUSES.has(patch.status)) {
      return { ok: false, error: `Unknown status: ${patch.status}` };
    }
    updates.status = patch.status;
    updates.status_updated_at = new Date().toISOString();
  }
  if (patch.caseId !== undefined) updates.case_id = patch.caseId;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.dueAt !== undefined) updates.due_at = patch.dueAt;

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'Nothing to update.' };
  }

  const { error } = await supabase
    .from('firm_documents')
    .update(updates)
    .eq('id', documentId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/documents');
  revalidatePath(`/counsel/documents/${documentId}`);
  return { ok: true };
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
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };

  // AUTHZ (IDOR guard): everything below runs on the service-role admin
  // client (RLS-bypassing) - it downloads, hashes, appends to, and
  // mutates the target document. So we MUST verify the caller belongs
  // to firmId with a role allowed to send for signature BEFORE any of
  // that, or a member of firm A could pass firm B's firmId/documentId
  // and act on firm B's document. (Audit 2026-07-03, H1.)
  {
    const { data: mem } = await supabase
      .from('firm_members')
      .select('role')
      .eq('firm_id', firmId)
      .eq('user_id', user.id)
      .maybeSingle();
    const role = (mem as { role?: string } | null)?.role;
    const POSTING_ROLES = ['owner', 'admin', 'attorney', 'paralegal'];
    if (!role || !POSTING_ROLES.includes(role)) {
      return {
        ok: false,
        error: 'You do not have permission to send this document for signature.',
      };
    }
  }
  await requireActiveFirm(firmId);

  // Compute SHA-256 of the document at the moment the request is
  // created so the audit trail can prove the bytes the signers
  // consented to match the bytes the firm later relies on. We pull
  // the document file_path, download from storage, hash. Failure to
  // hash does not block creating the request - falls back to null.
  //
  // Side effect (audit V5 "OCR fallback signature box" feature): we
  // also pre-place each signer's signature anchor here. If the
  // source PDF has neither an AcroForm signature field nor any
  // detectable "Signature:" / "X ____" text, we APPEND a signature
  // box at the bottom of the document so the final stamped output
  // still has somewhere to land the captured PNG. The appended
  // version is stored under signable_file_path; file_path stays
  // grounded in the bytes the firm uploaded (the SHA-256 hashes
  // those original bytes, not the appended copy).
  const { data: doc } = await admin
    .from('firm_documents')
    .select('name, file_path, signable_file_path, firm_id')
    .eq('id', documentId)
    .maybeSingle();
  // The document must belong to the firm the caller is authorized for -
  // otherwise the guard above (scoped to firmId) means nothing.
  if (!doc || (doc as { firm_id?: string }).firm_id !== firmId) {
    return { ok: false, error: 'Document not found for this firm.' };
  }
  const docName = (doc as { name?: string } | null)?.name ?? 'Document';
  const docPath = (doc as { file_path?: string } | null)?.file_path ?? null;
  let documentSha256: string | null = null;
  let sourceBytes: Buffer | null = null;
  if (docPath) {
    try {
      const { data: bytes, error: dlErr } = await admin.storage
        .from('firm-documents')
        .download(docPath);
      if (!dlErr && bytes) {
        sourceBytes = Buffer.from(await bytes.arrayBuffer());
        const { sha256 } = await import('./esign-audit');
        documentSha256 = sha256(sourceBytes);
      }
    } catch {
      /* hash failure must not block signing */
    }
  }

  // Run the anchor detection + fallback layout. When the source PDF
  // bytes were unavailable or pdf-lib couldn't parse them, we fall
  // back to the legacy default position (page 1, top-left-ish) on a
  // per-signer basis so signing can still proceed. The renderer
  // will use whatever positions we record here.
  type SignerWithPlacement = (typeof signers)[number] & {
    placement: import('./signature-anchors').SignaturePlacement;
    placementSource: import('./signature-anchors').DetectionSource;
  };
  let placedSigners: SignerWithPlacement[];
  let appendedBytes: Uint8Array | null = null;
  if (sourceBytes) {
    try {
      const { placeSignaturesIfMissing } = await import('./signature-anchors');
      const result = await placeSignaturesIfMissing(
        new Uint8Array(sourceBytes),
        signers.map((s) => ({
          email: s.email,
          name: s.name ?? null,
          positionPage: s.positionPage,
          positionX: s.positionX,
          positionY: s.positionY,
        })),
      );
      if (result.pdfBytesChanged) appendedBytes = result.pdfBytes;
      placedSigners = signers.map((s, i) => ({
        ...s,
        placement: result.signers[i].placement,
        placementSource: result.signers[i].source,
      }));
    } catch {
      // pdf-lib parse failure (encrypted, malformed, non-PDF blob,
      // etc.) - fall back to the legacy default. The signer still
      // gets a working request; the renderer will write the PNG to
      // the same default coordinate.
      placedSigners = signers.map((s) => ({
        ...s,
        placement: {
          positionPage: s.positionPage ?? 1,
          positionX: s.positionX ?? 0.1,
          positionY: s.positionY ?? 0.1,
          widthPt: 220,
          heightPt: 64,
        },
        placementSource: 'caller-supplied',
      }));
    }
  } else {
    placedSigners = signers.map((s) => ({
      ...s,
      placement: {
        positionPage: s.positionPage ?? 1,
        positionX: s.positionX ?? 0.1,
        positionY: s.positionY ?? 0.1,
        widthPt: 220,
        heightPt: 64,
      },
      placementSource: 'caller-supplied',
    }));
  }

  // If we appended signature boxes, upload the derived PDF under a
  // sibling path and record it as the firm_documents.signable_file
  // _path. We deliberately don't overwrite file_path - the original
  // bytes remain the canonical source for SHA-256 reproduction.
  let signablePath: string | null = null;
  if (appendedBytes && docPath) {
    const dotIdx = docPath.lastIndexOf('.');
    const base = dotIdx > 0 ? docPath.slice(0, dotIdx) : docPath;
    signablePath = `${base}.signable.pdf`;
    try {
      const { error: upErr } = await admin.storage
        .from('firm-documents')
        .upload(signablePath, appendedBytes, {
          contentType: 'application/pdf',
          upsert: true,
        });
      if (!upErr) {
        await admin
          .from('firm_documents')
          .update({ signable_file_path: signablePath })
          .eq('id', documentId);
      } else {
        // Upload failed - drop the signable_file_path back to null so
        // the renderer falls back to file_path. The placements still
        // work; the signer simply doesn't see the appended box.
        signablePath = null;
      }
    } catch {
      signablePath = null;
    }
  }

  const { data: req, error: reqErr } = await supabase
    .from('firm_signing_requests')
    .insert({
      firm_id: firmId,
      document_id: documentId,
      requested_by: user.id,
      message,
      status: 'sent' as FirmSigningStatus,
      sent_at: new Date().toISOString(),
      document_sha256: documentSha256,
    })
    .select('id')
    .single();
  if (reqErr || !req) return { ok: false, error: reqErr?.message ?? 'Could not create request.' };
  const requestId = (req as { id: string }).id;

  // Move the document into 'sent' state since it's now in the signer's
  // hands. The operator can advance to a signed_* state once execution
  // happens, or back to 'pending' if a counterparty needs more time.
  await admin
    .from('firm_documents')
    .update({
      status: 'sent',
      status_updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .in('status', ['submitted', 'received', 'ready', 'pending', 'on_hold']);

  // Append the first event in the chain. request_created records who
  // initiated it + the document hash; later events chain off this one.
  // We also persist the placement-source breakdown so an auditor can
  // see at a glance whether each signature landed on an existing
  // anchor or on an appended fallback box.
  const { appendSignatureEvent } = await import('./esign-audit');
  await appendSignatureEvent(admin, {
    signingRequestId: requestId,
    eventType: 'request_created',
    userId: user.id,
    documentSha256,
    metadata: {
      document_id: documentId,
      document_name: docName,
      signer_count: signers.length,
      signable_file_path: signablePath,
      placement_sources: placedSigners.reduce<Record<string, number>>(
        (acc, s) => {
          acc[s.placementSource] = (acc[s.placementSource] ?? 0) + 1;
          return acc;
        },
        {},
      ),
    },
  });
  // Lazy-load the notifications producer so this action stays cheap
  // when notifications are no-ops (eg. Supabase not configured in dev).
  const { createNotification } = await import('./notifications');
  const { sha256 } = await import('./esign-audit');

  // Firm brand for the outgoing mail, so signing emails read as the
  // firm ("Zinpro Legal") rather than a generic Advottic notice. The
  // address stays the verified sender for DKIM/DMARC (see sendEmail),
  // only the display name + template branding change.
  const { data: firmRow } = await admin
    .from('firms')
    .select('name, logo_url')
    .eq('id', firmId)
    .maybeSingle();
  const firmName =
    ((firmRow as { name?: string } | null)?.name ?? 'Advottic').trim() ||
    'Advottic';
  const firmLogo =
    (firmRow as { logo_url?: string | null } | null)?.logo_url ?? null;
  // Sender display name for the email body.
  const { data: senderMember } = await admin
    .from('firm_members')
    .select('display_name')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const senderName =
    ((senderMember as { display_name?: string | null } | null)?.display_name ||
      '').trim() ||
    (user.email ? user.email.split('@')[0] : '') ||
    'A team member';
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

  for (const signer of placedSigners) {
    const normalizedEmail = signer.email.trim().toLowerCase();

    // Resolve the signer to an Advottic user (if any) so we can (a)
    // drop an in-app notification and (b) decide whether they're an
    // INTERNAL signer (a member/employee of THIS firm). Internal
    // signers are already authenticated and the document also lands in
    // their portal, so they get the branded link only. EXTERNAL signers
    // get a second, one-time access code they must enter before the
    // document is shown - so a forwarded link alone can't open it.
    let signerUserId: string | null = null;
    try {
      const { data: prof } = await admin
        .from('profiles')
        .select('id')
        .eq('email', normalizedEmail)
        .maybeSingle();
      signerUserId = (prof as { id?: string } | null)?.id ?? null;
      if (!signerUserId) {
        const { data: au } = await admin
          .schema('auth')
          .from('users')
          .select('id')
          .eq('email', normalizedEmail)
          .maybeSingle();
        signerUserId = (au as { id?: string } | null)?.id ?? null;
      }
    } catch {
      /* resolution is best-effort */
    }

    let internal = false;
    if (signerUserId) {
      try {
        const { data: mem } = await admin
          .from('firm_members')
          .select('id')
          .eq('firm_id', firmId)
          .eq('user_id', signerUserId)
          .maybeSingle();
        if (mem) internal = true;
        if (!internal) {
          const { data: emp } = await admin
            .from('firm_employees')
            .select('id')
            .eq('firm_id', firmId)
            .eq('user_id', signerUserId)
            .is('deactivated_at', null)
            .maybeSingle();
          if (emp) internal = true;
        }
      } catch {
        /* classification failure -> treat as external (stricter) */
      }
    }

    const isExternal = !internal;
    // Generate the one-time code for external signers up front; store
    // only its hash. Plaintext lives just long enough to email it.
    const accessCode = isExternal ? newAccessCode() : null;

    const token = newToken(32);
    const { data: sigRow } = await admin
      .from('firm_signatures')
      .insert({
        signing_request_id: requestId,
        signer_email: normalizedEmail,
        signer_name: signer.name?.trim() || null,
        token,
        // Placement comes from signature-anchors.ts. When the caller
        // provided explicit coordinates these are echoed back; when
        // they didn't, the values either map to a detected anchor
        // (AcroForm field / text-pattern match) or to the appended
        // fallback box at the bottom of the page.
        position_page: signer.placement.positionPage,
        position_x: signer.placement.positionX,
        position_y: signer.placement.positionY,
        access_code_hash: accessCode ? sha256(accessCode) : null,
      })
      .select('id')
      .single();
    const signatureId = (sigRow as { id?: string } | null)?.id ?? null;

    const url = `${baseUrl}/sign/${token}`;

    if (signerUserId) {
      try {
        await createNotification({
          userId: signerUserId,
          type: 'signing_request_received',
          title: `Signature requested: ${docName}`,
          body: `${senderName} sent you "${docName}" for signature.`,
          link: `/sign/${token}`,
        });
      } catch {
        /* notifications are best-effort */
      }
    }

    // Email 1: the branded sign link.
    await sendEmail({
      to: signer.email,
      fromName: firmName,
      subject: `${firmName}: signature requested for ${docName}`,
      html: buildSigningRequestEmailHtml({
        firmName,
        logoUrl: firmLogo,
        senderName,
        documentName: docName,
        message,
        link: url,
        codeSeparately: isExternal,
      }),
      text:
        `${senderName} at ${firmName} requested your signature on "${docName}".\n\n` +
        `Review and sign (the document stays inside Advottic):\n${url}\n\n` +
        (isExternal
          ? 'For your security, a one-time access code was sent to this address in a separate email. Enter it to open the document.\n'
          : 'This link is single-use.\n'),
    }).catch(() => {});

    // Email 2 (external only): the one-time access code.
    if (isExternal && accessCode) {
      await sendEmail({
        to: signer.email,
        fromName: firmName,
        subject: `${firmName}: your access code for ${docName}`,
        html: buildSigningCodeEmailHtml({
          firmName,
          logoUrl: firmLogo,
          documentName: docName,
          code: accessCode,
        }),
        text:
          `Your one-time access code for "${docName}" is: ${accessCode}\n\n` +
          'Enter it on the sign page from your other email to open the document. Never share this code.',
      }).catch(() => {});
      if (signatureId) {
        await appendSignatureEvent(admin, {
          signingRequestId: requestId,
          signatureId,
          eventType: 'access_code_sent',
          signerEmail: normalizedEmail,
        }).catch(() => {});
      }
    }
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
  // The channel says which organization this is, and the argument does not, so
  // the firm has to be resolved before anything is written. Read through the
  // USER-scoped client on purpose: RLS already limits it to channels the
  // sender belongs to, so this cannot become a way to probe another firm's
  // channel ids.
  //
  // This action matters more than its size suggests. The fan-out below sends
  // OUTBOUND notification email and fires the organization's webhooks, so a
  // suspended organization, which is the abuse-response state, could otherwise
  // still reach third parties through it.
  //
  // A channel we cannot read is a refusal, not a pass. The insert would have
  // failed on RLS anyway; saying so here is the same answer, earlier.
  const { data: channelRef } = await supabase
    .from('firm_channels')
    .select('firm_id')
    .eq('id', channelId)
    .maybeSingle();
  const channelFirmId = (channelRef as { firm_id?: string } | null)?.firm_id;
  if (!channelFirmId) return { ok: false, error: 'Channel not found.' };
  await requireActiveFirm(channelFirmId);
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
  const messageId = (data as { id: string }).id;

  // Touch last_read_at on the sender's membership row so they don't
  // see their own message as unread.
  await supabase
    .from('firm_channel_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('user_id', user.id);

  // Post-insert fan-out runs through the admin client so it can read
  // channel + firm membership + webhook configs without depending on
  // the sender's RLS perspective. Every branch is best-effort: a
  // notification or webhook miss never fails the send itself.
  const admin = createAdminSupabase();
  if (admin) {
    // We need the channel context (firm_id, name, case_id) and the
    // sender's display name once, then fan out. One read, one map.
    const [{ data: channelRow }, { data: senderRow }] = await Promise.all([
      admin
        .from('firm_channels')
        .select('id, firm_id, name, topic, kind, case_id')
        .eq('id', channelId)
        .maybeSingle(),
      admin
        .from('firm_members')
        .select('display_name, email')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    const channel = channelRow as
      | {
          id: string;
          firm_id: string;
          name: string | null;
          topic: string | null;
          kind: string;
          case_id: string | null;
        }
      | null;
    const sender = (senderRow as { display_name: string | null; email: string | null } | null) ?? null;
    const senderName = sender?.display_name ?? sender?.email ?? user.email ?? 'A teammate';

    if (channel) {
      // Run @-mentions and webhook fan-out concurrently. Both rely on
      // admin client + channel context; both swallow their own errors.
      await Promise.allSettled([
        fanoutMentionNotifications({
          admin,
          channel,
          messageId,
          body: trimmed,
          senderUserId: user.id,
          senderName,
        }),
        fanoutWebhooks({
          admin,
          channel,
          body: trimmed,
          senderName,
        }),
      ]);
    }
  }

  return { ok: true, messageId };
}

// =====================================================================
// Chat fan-out helpers
// =====================================================================

type AdminSupabase = NonNullable<ReturnType<typeof createAdminSupabase>>;

type ChannelContext = {
  id: string;
  firm_id: string;
  name: string | null;
  topic: string | null;
  kind: string;
  case_id: string | null;
};

/**
 * Detect @-mentions in a message body and emit a notification + email
 * to every mentioned firm member who is also a channel member.
 *
 * Match rules:
 *   - "@<handle>" where handle is letters / numbers / `.` / `_` / `-`
 *   - Match handle against firm_members.display_name (case-insensitive,
 *     non-alphanumerics stripped) OR against the local-part of
 *     firm_members.email
 *   - The sender is never notified for their own mention
 *   - Each user is notified at most once per message, even if they're
 *     mentioned by multiple aliases
 *
 * The MENTION_RE is intentionally narrow to avoid matching things like
 * "@2 PM" or "@noon" - one-character matches are excluded by the {2,}.
 */
const MENTION_RE = /(^|\s)@([a-zA-Z][a-zA-Z0-9._-]{1,30})\b/g;

function extractMentionHandles(body: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(body)) !== null) {
    out.add(m[2].toLowerCase());
  }
  MENTION_RE.lastIndex = 0;
  return Array.from(out);
}

function memberMatchesHandle(
  handle: string,
  member: { display_name: string | null; email: string | null },
): boolean {
  const normalizedHandle = handle.replace(/[^a-z0-9]/g, '');
  if (!normalizedHandle) return false;
  const displayNorm = (member.display_name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (displayNorm && displayNorm.startsWith(normalizedHandle)) return true;
  const localPart = (member.email ?? '').split('@')[0]?.toLowerCase() ?? '';
  if (localPart && localPart.replace(/[^a-z0-9]/g, '') === normalizedHandle) return true;
  return false;
}

async function fanoutMentionNotifications(args: {
  admin: AdminSupabase;
  channel: ChannelContext;
  messageId: string;
  body: string;
  senderUserId: string;
  senderName: string;
}): Promise<void> {
  const { admin, channel, messageId, body, senderUserId, senderName } = args;
  const handles = extractMentionHandles(body);
  if (handles.length === 0) return;

  // Pull only the channel's members so we don't notify a firm-wide
  // user who isn't actually in this thread. Then attribute names from
  // firm_members so notifications can be addressed even when the
  // member row doesn't carry an email directly.
  const { data: memberRows } = await admin
    .from('firm_channel_members')
    .select('user_id')
    .eq('channel_id', channel.id);
  const channelUserIds = new Set(
    ((memberRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  );
  if (channelUserIds.size === 0) return;

  const { data: firmMembers } = await admin
    .from('firm_members')
    .select('user_id, display_name, email, role')
    .eq('firm_id', channel.firm_id);

  const candidates = ((firmMembers ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    email: string | null;
    role: string;
  }>).filter(
    (m) => channelUserIds.has(m.user_id) && m.user_id !== senderUserId,
  );

  // Build the matched-user list and dedupe by user_id so a single
  // user mentioned twice in one message only gets one notification.
  const matched = new Map<string, { email: string | null; displayName: string | null }>();
  for (const handle of handles) {
    for (const member of candidates) {
      if (memberMatchesHandle(handle, member)) {
        if (!matched.has(member.user_id)) {
          matched.set(member.user_id, {
            email: member.email,
            displayName: member.display_name,
          });
        }
      }
    }
  }
  if (matched.size === 0) return;

  const channelLabel =
    channel.name && channel.name.length > 0
      ? `#${channel.name}`
      : channel.kind === 'dm'
        ? 'a direct message'
        : channel.kind === 'group_dm'
          ? 'a group conversation'
          : 'a firm channel';
  const preview = body.slice(0, 180) + (body.length > 180 ? '…' : '');
  const messageLink = `/counsel/chat?message=${messageId}`;

  // Two parallel passes: notification rows for the inbox, and emails
  // for out-of-app reach. The inbox path is the durable one; email is
  // best-effort (skip the mention notification email if Resend isn't
  // configured).
  await Promise.allSettled([
    Promise.all(
      Array.from(matched.entries()).map(([userId, m]) =>
        admin.from('notifications').insert({
          user_id: userId,
          type: 'system',
          title: `${senderName} mentioned you in ${channelLabel}`,
          body: preview,
          link: messageLink,
          actor_user_id: senderUserId,
        }),
      ),
    ),
    Promise.all(
      Array.from(matched.values())
        .filter((m): m is { email: string; displayName: string | null } => Boolean(m.email))
        .map((m) => {
          const link = `https://advottic.com${messageLink}`;
          // sendEmail requires html; text-only would shed our brand
          // wrapper. Plain HTML is fine - no inlining concerns at
          // this length, no images, no external assets.
          const escapedPreview = preview
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          const escapedSender = senderName
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          const escapedChannel = channelLabel
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return sendEmail({
            to: m.email,
            subject: `${senderName} mentioned you in ${channelLabel} - Advottic`,
            text:
              `${senderName} mentioned you in ${channelLabel} on Advottic.\n\n` +
              `Preview:\n${preview}\n\n` +
              `Open the conversation: ${link}\n\n` +
              `You can mute @-mention emails in Counsel > Settings > Notifications.`,
            html: `<p><strong>${escapedSender}</strong> mentioned you in <strong>${escapedChannel}</strong> on Advottic.</p>
<blockquote style="border-left:3px solid #d5bb7e;padding-left:12px;color:#444;">${escapedPreview}</blockquote>
<p><a href="${link}" style="background:#0f2d24;color:#f4ecd4;padding:8px 14px;border-radius:6px;text-decoration:none;font-family:system-ui,sans-serif;">Open the conversation</a></p>
<p style="color:#777;font-size:12px;">You can mute @-mention emails in Counsel &gt; Settings &gt; Notifications.</p>`,
          }).catch(() => null);
        }),
    ),
  ]);
}

/**
 * Fan a new chat message out to every active firm_webhook_config that
 * applies. A webhook applies when:
 *
 *   - is_active = true
 *   - channel_filter is null (firm-wide) OR matches the message's channel
 *
 * Slack and Teams have different payload shapes; "generic" sends raw
 * JSON that any HTTP endpoint can consume. include_body controls
 * whether the message body is echoed or only the metadata (sender,
 * channel, link) - default is metadata-only so privileged content
 * never leaves the vault unless an owner opts in.
 *
 * Failure is logged into firm_webhook_configs.last_error so the
 * settings page can surface it to the firm. We never throw - a 500
 * from a misconfigured Slack workflow must not break the chat send.
 */
async function fanoutWebhooks(args: {
  admin: AdminSupabase;
  channel: ChannelContext;
  body: string;
  senderName: string;
}): Promise<void> {
  const { admin, channel, body, senderName } = args;
  const { data: webhooks } = await admin
    .from('firm_webhook_configs')
    .select('id, kind, url, label, channel_filter, include_body')
    .eq('firm_id', channel.firm_id)
    .eq('is_active', true);
  const applicable = ((webhooks ?? []) as Array<{
    id: string;
    kind: 'slack' | 'teams' | 'generic';
    url: string;
    label: string | null;
    channel_filter: string | null;
    include_body: boolean;
  }>).filter((w) => !w.channel_filter || w.channel_filter === channel.id);
  if (applicable.length === 0) return;

  const channelLabel =
    channel.name && channel.name.length > 0 ? `#${channel.name}` : 'direct message';
  const preview = body.slice(0, 280) + (body.length > 280 ? '…' : '');

  await Promise.allSettled(
    applicable.map(async (w) => {
      try {
        const payload = buildWebhookPayload({
          kind: w.kind,
          includeBody: w.include_body,
          senderName,
          channelLabel,
          preview,
          channelId: channel.id,
        });
        const res = await fetch(w.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          await admin
            .from('firm_webhook_configs')
            .update({
              failure_count: ((await currentFailureCount(admin, w.id)) ?? 0) + 1,
              last_error: `HTTP ${res.status} from webhook ${w.label ?? w.kind}`,
            })
            .eq('id', w.id);
          return;
        }
        await admin
          .from('firm_webhook_configs')
          .update({
            last_fired_at: new Date().toISOString(),
            failure_count: 0,
            last_error: null,
          })
          .eq('id', w.id);
      } catch (err) {
        await admin
          .from('firm_webhook_configs')
          .update({
            failure_count: ((await currentFailureCount(admin, w.id)) ?? 0) + 1,
            last_error: err instanceof Error ? err.message.slice(0, 240) : 'unknown error',
          })
          .eq('id', w.id);
      }
    }),
  );
}

async function currentFailureCount(
  admin: AdminSupabase,
  id: string,
): Promise<number | null> {
  const { data } = await admin
    .from('firm_webhook_configs')
    .select('failure_count')
    .eq('id', id)
    .maybeSingle();
  return (data as { failure_count: number } | null)?.failure_count ?? null;
}

function buildWebhookPayload(args: {
  kind: 'slack' | 'teams' | 'generic';
  includeBody: boolean;
  senderName: string;
  channelLabel: string;
  preview: string;
  channelId: string;
}): unknown {
  const { kind, includeBody, senderName, channelLabel, preview, channelId } = args;
  const summary = `${senderName} posted in ${channelLabel} on Advottic`;
  const link = `https://advottic.com/counsel/chat?channel=${channelId}`;
  if (kind === 'slack') {
    return {
      text: summary,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${senderName}* posted in *${channelLabel}*` } },
        ...(includeBody
          ? [{ type: 'section', text: { type: 'mrkdwn', text: '>>> ' + preview } }]
          : []),
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open in Advottic' },
              url: link,
            },
          ],
        },
      ],
    };
  }
  if (kind === 'teams') {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary,
      themeColor: '0F2D24',
      title: `${senderName} posted in ${channelLabel}`,
      sections: includeBody ? [{ text: preview }] : [],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'Open in Advottic',
          targets: [{ os: 'default', uri: link }],
        },
      ],
    };
  }
  // generic
  return {
    source: 'advottic.counsel.chat',
    event: 'message.created',
    sender_name: senderName,
    channel: channelLabel,
    preview: includeBody ? preview : null,
    link,
  };
}

// =====================================================================
// Webhook configs (Phase 2 - Slack/Teams/generic fan-out)
// =====================================================================

export type FirmWebhookConfig = {
  id: string;
  firmId: string;
  kind: 'slack' | 'teams' | 'generic';
  label: string | null;
  url: string;
  channelFilter: string | null;
  isActive: boolean;
  includeBody: boolean;
  createdAt: string;
  lastFiredAt: string | null;
  failureCount: number;
  lastError: string | null;
};

export async function listFirmWebhooksAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string; webhooks?: FirmWebhookConfig[] }> {
  await requireUser();
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_webhook_configs')
    .select(
      'id, firm_id, kind, label, url, channel_filter, is_active, include_body, created_at, last_fired_at, failure_count, last_error',
    )
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  const webhooks: FirmWebhookConfig[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    firmId: row.firm_id as string,
    kind: row.kind as 'slack' | 'teams' | 'generic',
    label: (row.label as string | null) ?? null,
    url: row.url as string,
    channelFilter: (row.channel_filter as string | null) ?? null,
    isActive: row.is_active as boolean,
    includeBody: row.include_body as boolean,
    createdAt: row.created_at as string,
    lastFiredAt: (row.last_fired_at as string | null) ?? null,
    failureCount: (row.failure_count as number) ?? 0,
    lastError: (row.last_error as string | null) ?? null,
  }));
  return { ok: true, webhooks };
}

export async function createFirmWebhookAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; webhookId?: string }> {
  const user = await requireUser();
  const kindRaw = String(formData.get('kind') ?? '').trim().toLowerCase();
  const kind =
    kindRaw === 'slack' || kindRaw === 'teams' || kindRaw === 'generic'
      ? (kindRaw as 'slack' | 'teams' | 'generic')
      : null;
  if (!kind) {
    return { ok: false, error: 'Pick a webhook kind (Slack, Teams, or generic).' };
  }
  const url = String(formData.get('url') ?? '').trim();
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, error: 'Webhook URL must start with https://.' };
  }
  // Vendor sanity check - friendlier than a 4xx from the wrong endpoint
  // at first message.
  if (kind === 'slack' && !/hooks\.slack\.com\//i.test(url)) {
    return {
      ok: false,
      error: 'Slack webhook URLs come from hooks.slack.com. Double-check the URL.',
    };
  }
  if (
    kind === 'teams' &&
    !/(office\.com|outlook\.com|webhook\.office\.com)\//i.test(url)
  ) {
    return {
      ok: false,
      error:
        'Microsoft Teams webhook URLs come from outlook.office.com or webhook.office.com.',
    };
  }
  const label = String(formData.get('label') ?? '').trim() || null;
  const channelFilterRaw = String(formData.get('channelFilter') ?? '').trim();
  const channelFilter = channelFilterRaw.length > 0 ? channelFilterRaw : null;
  const includeBody = formData.get('includeBody') === 'on' || formData.get('includeBody') === 'true';

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_webhook_configs')
    .insert({
      firm_id: firmId,
      kind,
      label,
      url,
      channel_filter: channelFilter,
      is_active: true,
      include_body: includeBody,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/settings');
  return { ok: true, webhookId: (data as { id: string }).id };
}

export async function setFirmWebhookActiveAction(
  webhookId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_webhook_configs')
    .update({ is_active: active })
    .eq('id', webhookId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/settings');
  return { ok: true };
}

export async function deleteFirmWebhookAction(
  webhookId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_webhook_configs')
    .delete()
    .eq('id', webhookId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/settings');
  return { ok: true };
}

// =====================================================================
// Matter channels (Phase 3 - getOrCreateMatterChannel)
// =====================================================================

/**
 * Idempotently fetch or create the chat channel for a specific case.
 *
 * Behavior:
 *   - If a channel already exists for (firm_id, case_id) -> return it
 *   - Otherwise create a 'channel' kind channel with case_id set and
 *     auto-add every firm_members user as a channel member
 *
 * Auto-membership is a deliberate choice: at a small firm, every
 * attorney + paralegal touching matters can see the matter channel.
 * When per-matter role scoping ships (counsel-only vs paralegal-only),
 * this function will narrow membership accordingly. For now: the
 * unique index on firm_channels.case_id ensures one channel per case,
 * and the membership write is best-effort.
 */
export async function getOrCreateMatterChannelAction(
  firmId: string,
  caseId: string,
  fallbackName: string,
): Promise<{ ok: boolean; error?: string; channelId?: string }> {
  await requireUser();
  // The slow path below writes through the service-role client, which the
  // firm_channels insert policy cannot see, so membership has to be checked
  // here or any signed-in user could open channels inside another firm.
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const supabase = createServerSupabase();

  // Fast path: existing matter channel.
  const { data: existing } = await supabase
    .from('firm_channels')
    .select('id')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .maybeSingle();
  if (existing) return { ok: true, channelId: (existing as { id: string }).id };

  // Slow path: create + auto-membership. Uses admin client so the
  // INSERT into firm_channel_members can fan to every firm member
  // even if the caller's RLS would normally not permit that.
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server missing service role key.' };
  // The matter has to belong to this firm, or a member of one firm could
  // stamp another firm's matter id onto a channel in their own workspace.
  const { data: matterRow } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  if ((matterRow as { firm_id: string | null } | null)?.firm_id !== firmId) {
    return { ok: false, error: 'That matter is not in this firm.' };
  }
  const slug = slugify(fallbackName) || `matter-${caseId.slice(0, 8)}`;
  const { data: created, error: createErr } = await admin
    .from('firm_channels')
    .insert({
      firm_id: firmId,
      name: slug,
      topic: `Matter room - ${fallbackName}`,
      kind: 'channel',
      case_id: caseId,
      is_default: false,
    })
    .select('id')
    .single();
  if (createErr) {
    // The unique index may have raced with a parallel call; re-fetch.
    const { data: raced } = await admin
      .from('firm_channels')
      .select('id')
      .eq('firm_id', firmId)
      .eq('case_id', caseId)
      .maybeSingle();
    if (raced) return { ok: true, channelId: (raced as { id: string }).id };
    return { ok: false, error: createErr.message };
  }
  const channelId = (created as { id: string }).id;

  // Auto-add every firm member to the matter channel. Skip the
  // result silently - duplicates would violate the (channel_id,
  // user_id) primary key but that's the desired no-op behavior.
  const { data: members } = await admin
    .from('firm_members')
    .select('user_id')
    .eq('firm_id', firmId);
  const rows = ((members ?? []) as Array<{ user_id: string }>).map((m) => ({
    channel_id: channelId,
    user_id: m.user_id,
  }));
  if (rows.length > 0) {
    await admin.from('firm_channel_members').insert(rows);
  }
  revalidatePath('/counsel/chat');
  return { ok: true, channelId };
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
      <p><a href="${(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com')}/admin/counsel-requests">Review in admin dashboard</a></p>
    `,
    text: `${organizationName} has requested Advottic Counsel access.\n\nContact: ${contactName} <${contactEmail}>\nType: ${firmType}\n${description ? '\n' + description : ''}\n\nReview: ${(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com')}/admin/counsel-requests`,
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
    (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com') +
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

// =====================================================================
// Advottic HQ - admin-side counsel operations
// =====================================================================

/**
 * Verifies the caller is an admin and returns an admin Supabase
 * client + the caller's user. Used by every HQ action below.
 */
async function requireHqAdmin(): Promise<
  | { ok: true; admin: ReturnType<typeof createAdminSupabase>; userId: string }
  | { ok: false; error: string }
> {
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
  return { ok: true, admin, userId: user.id };
}

/**
 * Admins can flip a pending request into the 'scheduled' state and
 * record a proposed call time + note. The applicant gets an email
 * with the proposed slot. Approval still happens via
 * approveCounselAccessRequestAction once the call has been held.
 */
export async function scheduleCounselRequestAction(
  requestId: string,
  scheduledAtIso: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireHqAdmin();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { admin } = ctx;
  if (!admin) return { ok: false, error: 'Admin client unavailable.' };

  const when = new Date(scheduledAtIso);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: 'Invalid scheduled time.' };
  }
  if (when.getTime() < Date.now() - 60 * 60 * 1000) {
    return { ok: false, error: 'Scheduled time is in the past.' };
  }

  const { data: req } = await admin
    .from('firm_access_requests')
    .select('id, organization_name, contact_name, contact_email, status')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: 'Request not found.' };
  const r = req as {
    id: string;
    organization_name: string;
    contact_name: string;
    contact_email: string;
    status: string;
  };
  if (r.status !== 'pending' && r.status !== 'scheduled') {
    return { ok: false, error: `Cannot schedule a request that is already ${r.status}.` };
  }

  const { error } = await admin
    .from('firm_access_requests')
    .update({
      status: 'scheduled',
      scheduled_call_at: when.toISOString(),
      scheduled_call_note: note.trim() || null,
    })
    .eq('id', requestId);
  if (error) return { ok: false, error: error.message };

  const prettyTime = when.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  await sendEmail({
    to: r.contact_email,
    subject: `Advottic Counsel - call scheduled for ${r.organization_name}`,
    html: `
      <p>Hi ${escapeHtml(r.contact_name)},</p>
      <p>Thanks for applying for an Advottic Counsel workspace for <strong>${escapeHtml(r.organization_name)}</strong>. Before we activate the workspace, we'd like to spend a few minutes understanding how your team plans to use it.</p>
      <p><strong>Proposed time:</strong> ${escapeHtml(prettyTime)}</p>
      ${note.trim() ? `<p>${escapeHtml(note.trim())}</p>` : ''}
      <p>If that doesn't work, just reply to this email with a few options that do.</p>
      <p>- The Advottic team</p>
    `,
    text: `Hi ${r.contact_name},\n\nThanks for applying for an Advottic Counsel workspace for ${r.organization_name}. Before we activate the workspace, we'd like to spend a few minutes understanding how your team plans to use it.\n\nProposed time: ${prettyTime}\n${note.trim() ? '\n' + note.trim() + '\n' : ''}\nIf that doesn't work, reply with a few options that do.\n\n- The Advottic team`,
  }).catch(() => {});

  revalidatePath('/admin/counsel-requests');
  return { ok: true };
}

/**
 * Direct outbound invite: HQ knows of a firm we want on the platform
 * and dispatches a setup link without an application step. Mints a
 * standalone grant (request_id null, kind='outbound') and emails it.
 */
export async function dispatchCounselInviteAction(input: {
  organizationName: string;
  contactEmail: string;
  contactName: string | null;
  firmType: FirmType;
  inviteNote: string | null;
}): Promise<{ ok: boolean; error?: string; grantToken?: string }> {
  const ctx = await requireHqAdmin();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { admin, userId } = ctx;
  if (!admin) return { ok: false, error: 'Admin client unavailable.' };

  const organizationName = input.organizationName.trim();
  const contactEmail = input.contactEmail.trim().toLowerCase();
  const contactName = (input.contactName ?? '').trim() || null;
  const firmType = (FIRM_TYPES.includes(input.firmType) ? input.firmType : 'firm') as FirmType;
  if (!organizationName) return { ok: false, error: 'Organization name is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: 'Provide a valid contact email.' };
  }

  const token = newToken(48);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days for cold outreach
  const { error: insertErr } = await admin.from('firm_access_grants').insert({
    request_id: null,
    email: contactEmail,
    organization_name: organizationName,
    firm_type: firmType,
    token,
    expires_at: expiresAt.toISOString(),
    granted_by: userId,
    kind: 'outbound',
    invite_note: input.inviteNote?.trim() || null,
  });
  if (insertErr) return { ok: false, error: insertErr.message };

  const url =
    (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com') +
    `/counsel/welcome?grant=${encodeURIComponent(token)}`;
  const greeting = contactName ? `Hi ${escapeHtml(contactName)},` : 'Hello,';
  await sendEmail({
    to: contactEmail,
    subject: `An Advottic Counsel workspace has been reserved for ${organizationName}`,
    html: `
      <p>${greeting}</p>
      <p>We've reserved an Advottic Counsel workspace for <strong>${escapeHtml(organizationName)}</strong>. Counsel is our organizational legal workspace - clients, matters, documents, e-signature, and team chat in one premium environment, with the data sovereignty your organization needs.</p>
      ${input.inviteNote?.trim() ? `<blockquote style="border-left:3px solid #d5bb7e;margin:14px 0;padding:6px 14px;color:#444;">${escapeHtml(input.inviteNote.trim())}</blockquote>` : ''}
      <p>Use the single-use link below to claim it. Sign in with <strong>${escapeHtml(contactEmail)}</strong> when prompted.</p>
      <p><a href="${escapeHtml(url)}" style="background:#0f2d24;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Activate workspace</a></p>
      <p>If the button doesn't work, copy this URL into your browser:<br/><span style="font-family:monospace;font-size:13px;">${escapeHtml(url)}</span></p>
      <p>This link is single-use and expires in 30 days.</p>
      <p>- The Advottic team</p>
    `,
    text: `${contactName ? 'Hi ' + contactName + ',' : 'Hello,'}\n\nWe've reserved an Advottic Counsel workspace for ${organizationName}. Counsel is our organizational legal workspace - clients, matters, documents, e-signature, and team chat in one premium environment.\n\n${input.inviteNote?.trim() ? input.inviteNote.trim() + '\n\n' : ''}Activation link (sign in with ${contactEmail}):\n${url}\n\nSingle-use, expires in 30 days.\n\n- The Advottic team`,
  }).catch(() => {});

  revalidatePath('/admin/invitations');
  return { ok: true, grantToken: token };
}

/**
 * Resends an outstanding grant (re-emails the same token if not yet
 * accepted/expired). Used for follow-ups on slow-to-redeem invitations.
 */
export async function resendCounselInviteAction(
  grantId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireHqAdmin();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { admin } = ctx;
  if (!admin) return { ok: false, error: 'Admin client unavailable.' };

  const { data: grant } = await admin
    .from('firm_access_grants')
    .select('id, email, organization_name, token, expires_at, accepted_at, invite_note, kind')
    .eq('id', grantId)
    .maybeSingle();
  if (!grant) return { ok: false, error: 'Grant not found.' };
  const g = grant as {
    id: string;
    email: string;
    organization_name: string;
    token: string;
    expires_at: string;
    accepted_at: string | null;
    invite_note: string | null;
    kind: string;
  };
  if (g.accepted_at) return { ok: false, error: 'Already redeemed.' };
  if (new Date(g.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Grant has expired - issue a new invitation instead.' };
  }
  const url =
    (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com') +
    `/counsel/welcome?grant=${encodeURIComponent(g.token)}`;
  await sendEmail({
    to: g.email,
    subject: `Reminder: your Advottic Counsel workspace for ${g.organization_name}`,
    html: `
      <p>Just a friendly reminder that the Advottic Counsel workspace for <strong>${escapeHtml(g.organization_name)}</strong> is still waiting for you.</p>
      <p><a href="${escapeHtml(url)}" style="background:#0f2d24;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Activate workspace</a></p>
      <p style="font-family:monospace;font-size:13px;">${escapeHtml(url)}</p>
      <p>Single-use link. Expires ${escapeHtml(new Date(g.expires_at).toLocaleDateString())}.</p>
      <p>- The Advottic team</p>
    `,
    text: `Reminder: the Advottic Counsel workspace for ${g.organization_name} is still waiting for you.\n\nActivation link:\n${url}\n\nExpires ${new Date(g.expires_at).toLocaleDateString()}.\n\n- The Advottic team`,
  }).catch(() => {});
  revalidatePath('/admin/invitations');
  return { ok: true };
}

/**
 * Revokes an outstanding grant before it has been redeemed. Sets
 * expires_at to now so the welcome page rejects it.
 */
export async function revokeCounselGrantAction(
  grantId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireHqAdmin();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { admin } = ctx;
  if (!admin) return { ok: false, error: 'Admin client unavailable.' };
  const { data: grant } = await admin
    .from('firm_access_grants')
    .select('id, accepted_at')
    .eq('id', grantId)
    .maybeSingle();
  if (!grant) return { ok: false, error: 'Grant not found.' };
  if ((grant as { accepted_at: string | null }).accepted_at) {
    return { ok: false, error: 'Already redeemed - cannot revoke.' };
  }
  const { error } = await admin
    .from('firm_access_grants')
    .update({ expires_at: new Date().toISOString() })
    .eq('id', grantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/invitations');
  return { ok: true };
}

// =====================================================================
// Matters: create + assign
// =====================================================================

export type CreateFirmCaseInput = {
  title: string;
  /** Who/what the matter is about; stored as cases.subject_name. */
  subject?: string;
  /** person / business / state / entity - defaults to 'person'. */
  subjectType?: SubjectType;
  /** Full opposing-party dossier (legal name, AKA, address, etc.). */
  subjectProfile?: SubjectProfile;
  caseType?: string;
  /** Free-text jurisdiction; country defaults to 'US' when omitted. */
  jurisdictionCountry?: string;
  jurisdictionState?: string;
  jurisdictionCity?: string;
  /** Matter summary / facts, stored as cases.description. */
  description?: string;
  posture?: Posture;
  /** ISO datetime of the next hearing, or null when none is set yet. */
  hearingAt?: string | null;
  hearingLocation?: string | null;
  hearingNotes?: string | null;
};

/**
 * Creates a firm-owned matter from the minimal "New matter" form on
 * /counsel/cases. Until now a firm could only get a case via Import or
 * intake-conversion; there was no way to hand-open one.
 *
 * Writes through the service-role client (like every other firm-case
 * write in this codebase - see convertIntakeToCaseAction / import
 * lanes) after confirming the caller is a member of `firmId`. RLS on
 * public.cases only lets the row OWNER write, so a firm member creating
 * a matter on the firm's behalf must go through admin.
 *
 * Defaults: user_id (the row owner) and assigned_to are the creator, so
 * a freshly opened matter immediately shows in their "Assigned to me"
 * lane and can be re-routed from the case's assignee picker.
 */
export async function createFirmCaseAction(
  firmId: string,
  input: CreateFirmCaseInput,
): Promise<{ ok: boolean; error?: string; caseId?: string }> {
  const user = await requireUser();
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  await requireActiveFirm(firmId);
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const title = (input.title ?? '').trim();
  if (!title) return { ok: false, error: 'Give the matter a title.' };
  const subject = (input.subject ?? '').trim() || title;
  // case_type is stored as free text (no DB check constraint); the form
  // is a picker so we keep known values verbatim and fall back to
  // "Other" for anything unexpected.
  const rawType = (input.caseType ?? '').trim();
  const caseType: CaseType = (CASE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as CaseType)
    : 'Other';
  const posture: Posture = input.posture === 'defendant' ? 'defendant' : 'claimant';
  const jurisdictionCountry = (input.jurisdictionCountry ?? '').trim() || 'US';
  const jurisdictionState = (input.jurisdictionState ?? '').trim();
  const jurisdictionCity = (input.jurisdictionCity ?? '').trim();
  const validSubjectTypes: SubjectType[] = ['person', 'business', 'matter', 'state', 'entity'];
  const subjectType: SubjectType = validSubjectTypes.includes(input.subjectType as SubjectType)
    ? (input.subjectType as SubjectType)
    : 'person';
  const description = (input.description ?? '').trim();

  // Only keep non-empty profile fields, matching createCaseAction's shape so
  // a firm-opened matter carries the same opposing-party dossier a personal
  // case does (surfaced read-only in the Subject panel on the matter page).
  const rawProfile = input.subjectProfile ?? {};
  const subjectProfile: SubjectProfile = {};
  (Object.keys(rawProfile) as (keyof SubjectProfile)[]).forEach((k) => {
    const v = (rawProfile[k] ?? '').trim();
    if (v) subjectProfile[k] = v;
  });

  // Hearing is optional at creation; a malformed datetime is surfaced as a
  // friendly error rather than a server exception (mirrors createCaseAction).
  let hearingAt: string | null = null;
  const hearingRaw = (input.hearingAt ?? '').trim();
  if (hearingRaw) {
    const parsed = new Date(hearingRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'Hearing date is not a valid date and time.' };
    }
    hearingAt = parsed.toISOString();
  }
  const hearingLocation = (input.hearingLocation ?? '').trim() || null;
  const hearingNotes = (input.hearingNotes ?? '').trim() || null;

  const { data: created, error } = await admin
    .from('cases')
    .insert({
      firm_id: firmId,
      user_id: user.id,
      assigned_to: user.id,
      title,
      subject_name: subject,
      subject_type: subjectType,
      subject_profile: subjectProfile,
      case_type: caseType,
      status: 'open',
      posture,
      description,
      jurisdiction_country: jurisdictionCountry,
      jurisdiction_state: jurisdictionState,
      jurisdiction_city: jurisdictionCity,
      hearing_at: hearingAt,
      hearing_location: hearingLocation,
      hearing_notes: hearingNotes,
      sandbox: false,
    })
    .select('id')
    .single();
  if (error || !created) {
    return { ok: false, error: error?.message ?? 'Could not create the matter.' };
  }
  revalidatePath('/counsel/cases');
  revalidatePath('/counsel');
  return { ok: true, caseId: (created as { id: string }).id };
}

/**
 * Edit a firm matter's details (fix a typo, correct a name, update the
 * opposing-party dossier / jurisdiction / hearing). Admin-path write gated on
 * firm membership + the case belonging to that firm, mirroring
 * createFirmCaseAction. Reuses the same input shape; every editable field is
 * re-validated the same way it is at creation.
 */
export async function updateFirmCaseAction(
  firmId: string,
  caseId: string,
  input: CreateFirmCaseInput,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: kase } = await admin
    .from('cases')
    .select('id, firm_id')
    .eq('id', caseId)
    .maybeSingle();
  if (!kase || (kase as { firm_id: string | null }).firm_id !== firmId) {
    return { ok: false, error: 'That matter is not in this firm.' };
  }

  const title = (input.title ?? '').trim();
  if (!title) return { ok: false, error: 'Give the matter a title.' };
  const subject = (input.subject ?? '').trim() || title;
  const rawType = (input.caseType ?? '').trim();
  const caseType: CaseType = (CASE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as CaseType)
    : 'Other';
  const posture: Posture = input.posture === 'defendant' ? 'defendant' : 'claimant';
  const validSubjectTypes: SubjectType[] = ['person', 'business', 'matter', 'state', 'entity'];
  const subjectType: SubjectType = validSubjectTypes.includes(input.subjectType as SubjectType)
    ? (input.subjectType as SubjectType)
    : 'person';
  const jurisdictionCountry = (input.jurisdictionCountry ?? '').trim() || 'US';
  const jurisdictionState = (input.jurisdictionState ?? '').trim();
  const jurisdictionCity = (input.jurisdictionCity ?? '').trim();
  const description = (input.description ?? '').trim();

  const rawProfile = input.subjectProfile ?? {};
  const subjectProfile: SubjectProfile = {};
  (Object.keys(rawProfile) as (keyof SubjectProfile)[]).forEach((k) => {
    const v = (rawProfile[k] ?? '').trim();
    if (v) subjectProfile[k] = v;
  });

  let hearingAt: string | null = null;
  const hearingRaw = (input.hearingAt ?? '').trim();
  if (hearingRaw) {
    const parsed = new Date(hearingRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'Hearing date is not a valid date and time.' };
    }
    hearingAt = parsed.toISOString();
  }
  const hearingLocation = (input.hearingLocation ?? '').trim() || null;
  const hearingNotes = (input.hearingNotes ?? '').trim() || null;

  const { error } = await admin
    .from('cases')
    .update({
      title,
      subject_name: subject,
      subject_type: subjectType,
      subject_profile: subjectProfile,
      case_type: caseType,
      posture,
      description,
      jurisdiction_country: jurisdictionCountry,
      jurisdiction_state: jurisdictionState,
      jurisdiction_city: jurisdictionCity,
      hearing_at: hearingAt,
      hearing_location: hearingLocation,
      hearing_notes: hearingNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}

/**
 * Sets (or clears, when assigneeUserId is null) the responsible
 * attorney on a matter. Service-role write gated on firm membership:
 * the caller must belong to the matter's firm, and a non-null assignee
 * must be a member of that same firm - you can't assign a matter to
 * someone outside the firm.
 */
export async function setCaseAssigneeAction(
  caseId: string,
  assigneeUserId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: caseRow } = await admin
    .from('cases')
    .select('id, firm_id')
    .eq('id', caseId)
    .maybeSingle();
  const firmId = (caseRow as { firm_id: string | null } | null)?.firm_id ?? null;
  if (!firmId) return { ok: false, error: 'Matter not found.' };
  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You do not have access to this matter.' };
  }

  if (assigneeUserId) {
    const { data: member } = await admin
      .from('firm_members')
      .select('user_id')
      .eq('firm_id', firmId)
      .eq('user_id', assigneeUserId)
      .maybeSingle();
    if (!member) {
      return { ok: false, error: 'Assignee must be a member of this firm.' };
    }
  }

  const { error } = await admin
    .from('cases')
    .update({ assigned_to: assigneeUserId })
    .eq('id', caseId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/counsel/cases/${caseId}`);
  revalidatePath('/counsel/cases');
  revalidatePath('/counsel');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Matter collaborators - firm invites people to a matter with clear roles.
//
// Reuses the consumer case_collaborators system (same table, same invite
// email + held-invite flow) but authorizes the firm side: only an
// owner/admin/attorney of the matter's firm may invite or remove, and all
// writes go through the service-role client (the caller is not the case's
// row owner, so RLS would otherwise reject them).
// ---------------------------------------------------------------------------

/**
 * The four firm-facing invite roles, mapped onto case_collaborators roles:
 *   - represented -> 'represented' (client / represented party: view +
 *     contribute their own evidence/statements)
 *   - co_counsel  -> 'attorney'    (attorney-level: view + add exhibits)
 *   - contributor -> 'editor'      (add evidence/notes, no case management)
 *   - viewer      -> 'viewer'      (read-only)
 */
const FIRM_INVITE_ROLE_MAP: Record<string, CollaboratorRole> = {
  represented: 'represented',
  co_counsel: 'attorney',
  contributor: 'editor',
  viewer: 'viewer',
};

/** True only if the signed-in user is owner/admin/attorney of `firmId`. */
async function callerCanManageMatter(firmId: string): Promise<boolean> {
  return callerHasFirmRole(firmId, FIRM_MANAGE_ROLES);
}

/**
 * Invite someone to a firm matter with a role. Server-side authorizes the
 * caller as an owner/admin/attorney of the matter's firm - the client-sent
 * role is never trusted. Returns whether the invite email went out.
 */
export async function inviteMatterCollaboratorAction(
  caseId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; emailed?: boolean }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id, title')
    .eq('id', caseId)
    .maybeSingle();
  const cr = caseRow as { firm_id: string | null; title: string } | null;
  const firmId = cr?.firm_id ?? null;
  if (!firmId) return { ok: false, error: 'Matter not found.' };
  if (!(await callerCanManageMatter(firmId))) {
    return {
      ok: false,
      error: 'Only firm owners, admins, or attorneys can invite people to a matter.',
    };
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const roleKey = String(formData.get('role') ?? 'viewer');
  const role = FIRM_INVITE_ROLE_MAP[roleKey] ?? 'viewer';
  const inviteeName = String(formData.get('inviteeName') ?? '').trim().slice(0, 120) || null;
  const organization = String(formData.get('organization') ?? '').trim().slice(0, 160) || null;

  // The firm name personalizes the welcome email ("X at Firm invited you").
  const { data: firmRow } = await admin
    .from('firms')
    .select('name')
    .eq('id', firmId)
    .maybeSingle();
  const firmName = (firmRow as { name?: string | null } | null)?.name ?? null;

  try {
    const inviterName =
      (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'A colleague';
    const { emailed, caseTitle } = await inviteCollaboratorAsFirm({
      caseId,
      firmId,
      email,
      role,
      inviterId: user.id,
      inviterName,
      inviterEmail: user.email ?? null,
      inviteeName,
      organization,
      firmName,
    });

    // Best-effort audit trail.
    try {
      const { logCaseEvent } = await import('./activity');
      await logCaseEvent({
        caseId,
        eventType: 'collaborator_invited',
        metadata: { email, role, roleKey, via: 'firm' },
      });
    } catch {
      /* audit miss is non-blocking */
    }

    // Best-effort in-app notification if the invitee already has an account.
    try {
      const { data: prof } = await admin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      const inviteeId = (prof as { id?: string } | null)?.id;
      if (inviteeId) {
        const { createNotification } = await import('./notifications');
        await createNotification({
          userId: inviteeId,
          type: 'case_invited',
          title: 'You were added to a matter',
          body: caseTitle
            ? `Open the matter to start collaborating: ${caseTitle}`
            : 'Open the matter to start collaborating.',
          link: `/cases/${caseId}`,
          caseId,
        });
      }
    } catch {
      /* notification miss is non-blocking */
    }

    revalidatePath(`/counsel/cases/${caseId}`);
    return { ok: true, emailed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invite failed.',
    };
  }
}

/**
 * Remove a collaborator from a firm matter. Same owner/admin/attorney
 * authorization as the invite path.
 */
export async function removeMatterCollaboratorAction(
  caseId: string,
  collaboratorId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  const firmId = (caseRow as { firm_id: string | null } | null)?.firm_id ?? null;
  if (!firmId) return { ok: false, error: 'Matter not found.' };
  if (!(await callerCanManageMatter(firmId))) {
    return { ok: false, error: 'Not authorized to manage this matter.' };
  }

  try {
    // Capture who is being removed BEFORE the row is deleted, so we can also
    // cut a firm-provisioned guest identity if this was their last matter.
    let removedUserId: string | null = null;
    const { data: collabRow } = await admin
      .from('case_collaborators')
      .select('user_id')
      .eq('id', collaboratorId)
      .maybeSingle();
    removedUserId = (collabRow as { user_id: string | null } | null)?.user_id ?? null;

    // Deleting the collaborator row IS the revocation: the case-scoped guest
    // persona resolves matter access from these rows, and there is no re-grant
    // handler, so any held/pending invite or old magic link becomes inert.
    await removeCollaboratorAsFirm({ collaboratorId, firmId });

    // Belt-and-suspenders for firm-provisioned guests (see revokeGuestAccessOnRemoval).
    try {
      const { revokeGuestAccessOnRemoval } = await import('./counsel-guest');
      await revokeGuestAccessOnRemoval({ userId: removedUserId, firmId });
    } catch {
      /* guest-identity cut is non-blocking; the row deletion already revoked */
    }

    try {
      const { logCaseEvent } = await import('./activity');
      await logCaseEvent({
        caseId,
        eventType: 'collaborator_removed',
        metadata: { collaboratorId, via: 'firm' },
      });
    } catch {
      /* audit miss is non-blocking */
    }
    revalidatePath(`/counsel/cases/${caseId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Remove failed.',
    };
  }
}

/**
 * Server-side list of a matter's collaborators for the counsel case page.
 * Authorizes the caller as any member of the matter's firm (viewing is
 * open to the legal team; invite/remove is gated separately). Returns an
 * empty list for non-members.
 */
export async function listMatterCollaboratorsAction(
  caseId: string,
): Promise<Collaborator[]> {
  await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  const firmId = (caseRow as { firm_id: string | null } | null)?.firm_id ?? null;
  if (!firmId) return [];
  if (!(await callerIsFirmMember(firmId))) return [];
  return listCollaboratorsAsFirm(caseId, firmId);
}

// Marker so we can inspect at runtime whether the redirect helper is
// being treated as a side effect. Used by smoke tests.
export async function _firmActionsLoaded(): Promise<true> {
  return true;
}
