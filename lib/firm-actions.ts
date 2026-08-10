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
  FIRM_MATTER_ROLE_REFUSAL,
  FIRM_POSTING_ROLES,
} from './firm-authz';
import {
  sendEmail,
  buildMeetingInviteEmailHtml,
  buildSigningRequestEmailHtml,
  buildSigningCodeEmailHtml,
} from './email';
import { seatCheck } from './firm-access';
import { calmAiMessage } from './ai-errors';
import {
  LETTERHEAD_DESIGN_METADATA_KEY,
  normalizeLetterheadDesign,
  parseLetterheadDesignReply,
  type LetterheadDesign,
} from './letterhead-design';
import {
  DOCUMENT_LAYOUT_METADATA_KEY,
  normalizeDocumentLayout,
} from './document-layout';
import type { FirmRole, FirmSigningStatus, FirmType } from './firm-types';
import { FIRM_ROLES, FIRM_TYPES } from './firm-types';
import { CASE_TYPES, STATUS_LABEL, type CaseStatus, type CaseType, type Posture } from './types';
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
  DECIDED_INTAKE_STATUSES,
  INTAKE_DECISIONS,
  INTAKE_DECISION_NOTE_MAX,
  reopenedIntakeStatus,
  type IntakeDecision,
} from './intake-lanes';
import {
  INTAKE_COLS,
  hydratePeople,
  insertIntakeMessage,
  revalidateIntake,
  type IntakeRow,
} from './intake-notify';
import { checkRateLimit } from './rate-limit';
import {
  SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR,
  isUnknownColumnError,
  resolveDownloadColumnFallback,
} from './signer-view';
import { resolveSignerTurn } from './signer-order';
import {
  resolveSignatureMethodsColumnFallback,
  SIGNATURE_METHODS_UNSAVED_ERROR,
} from './submission-dispatch';
import type { SignatureMethod } from './signature-methods';
// The link email lives in a server-only module now, because a signer
// numbered second is invited from lib/signature-write.ts rather than
// from here, and a resend, a first send and a late invitation have to be
// the same message. See lib/signer-invite.ts.
import { sendSigningLinkEmail } from './signer-invite';
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
import { formatDateNumeric, formatDateTimeNumeric, formatDateWith } from './format';

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

// =====================================================================
// The DESIGNED letterhead
// =====================================================================
//
// The three actions below are the second and third routes to a letterhead:
// design one in the app, or import one out of a document the firm already
// has. The uploaded image above is the first, and it still wins wherever both
// exist (see lib/branded-document-pdf.ts).
//
// STORAGE, AND WHY THERE IS NO MIGRATION. The design is written to
// firms.metadata.letterhead_design. firms.metadata is an existing jsonb column
// and this feature adds no column of its own. Two consequences are load
// bearing here:
//
//   1. Every write is a read-modify-write of the metadata OBJECT, never a
//      whole-column overwrite. Other features (hideAdvotticLogo, the ticket
//      prefix, the surface toggles) keep their own keys in that same bag, and
//      an update that posted only this key would delete theirs.
//   2. Every read goes back through normalizeLetterheadDesign, which is the
//      trust boundary for a column this code does not own.
//
// The gate is the same one the uploader above uses: callerIsFirmAdmin, from
// lib/firm-authz.ts, as the first statement. Every export of this module is a
// public HTTP endpoint callable with arguments of the caller's choosing, so
// the hidden UI is not the gate and never was.

/** The firm's own words, so this is generous but still bounded. */
const LETTERHEAD_IMPORT_MAX_BYTES = 15 * 1024 * 1024;
/**
 * How much of the extracted document the reader is shown. A letterhead is at
 * the top of the first page by definition, so more text is not more signal:
 * it is the body of a contract competing with the header for attention.
 */
const LETTERHEAD_IMPORT_CHARS = 2000;

const LETTERHEAD_DESIGN_DENIED =
  'Only an owner or admin can change the letterhead.';

/**
 * Read the firm's metadata bag so a write can merge into it.
 *
 * Deliberately not readFirmMetadata further down this file, which collapses a
 * failed read into `{}`. That is the right answer where the caller is only
 * LOOKING something up, and the wrong one here: a merge that starts from `{}`
 * because the select blipped writes back a bag missing every other feature's
 * keys, silently clearing the firm's white-label toggle and ticket prefix.
 * This one reports the failure so the write is abandoned instead.
 */
async function readFirmMetadataForMerge(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  firmId: string,
): Promise<{ ok: true; metadata: Record<string, unknown> } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('firms')
    .select('metadata')
    .eq('id', firmId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const metadata =
    ((data as { metadata?: Record<string, unknown> } | null)?.metadata) ?? {};
  return { ok: true, metadata };
}

export async function saveFirmLetterheadDesignAction(
  firmId: string,
  design: unknown,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: LETTERHEAD_DESIGN_DENIED };
  }
  // Normalized before it is stored as well as after it is read. The client is
  // not the author of what lands in the column.
  const normalized = normalizeLetterheadDesign(design);
  if (!normalized) {
    return { ok: false, error: 'Add your firm name before saving the letterhead.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const current = await readFirmMetadataForMerge(admin, firmId);
  if (!current.ok) return { ok: false, error: current.error };
  const { error } = await admin
    .from('firms')
    .update({
      metadata: {
        ...current.metadata,
        [LETTERHEAD_DESIGN_METADATA_KEY]: normalized,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

export async function removeFirmLetterheadDesignAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: LETTERHEAD_DESIGN_DENIED };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const current = await readFirmMetadataForMerge(admin, firmId);
  if (!current.ok) return { ok: false, error: current.error };
  const next = { ...current.metadata };
  delete next[LETTERHEAD_DESIGN_METADATA_KEY];
  const { error } = await admin
    .from('firms')
    .update({ metadata: next, updated_at: new Date().toISOString() })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

const DOCUMENT_LAYOUT_DENIED =
  'Only an owner or admin can change the document layout.';

/**
 * The firm's default page layout: where the letterhead, watermark and footer
 * sit, and the state rule that stops a DRAFT mark once a document is signed.
 *
 * Stored on firms.metadata.document_layout, following the letterhead design
 * precedent above, so this half needs no migration. The per-template override
 * does need one, and it lives on firm_templates.document_layout.
 *
 * The same two properties are load bearing here as for the letterhead:
 *
 *   1. The write is a read-modify-write of the metadata OBJECT, through
 *      readFirmMetadataForMerge, which reports a failed read rather than
 *      collapsing it into `{}`. Posting only this key would delete the ticket
 *      prefix, the surface toggles and the letterhead design with it.
 *   2. Every read goes back through normalizeDocumentLayout, which clamps every
 *      number to a real bound, so a value some other writer left in the bag can
 *      only ever resolve to the default layout.
 *
 * WHAT THIS CANNOT DO, AND THE REASON IT IS SAFE TO OFFER AT ALL. Saving a
 * layout cannot move a document that has already been rendered. A document's
 * bytes are stored at first render and every counterparty blank's geometry is
 * recorded in the same write (lib/submission-document.ts); the live signing
 * overlay and the stamp on the executed copy read those recorded coordinates,
 * and nothing re-renders a stored document. A layout is an input to a render
 * that has not happened yet.
 */
export async function saveFirmDocumentLayoutAction(
  firmId: string,
  layout: unknown,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: DOCUMENT_LAYOUT_DENIED };
  }
  // Normalized before it is stored as well as after it is read. This is a
  // `'use server'` export and therefore a public HTTP endpoint, so what lands
  // in the column is whatever a direct caller sent, not whatever the builder's
  // controls permit.
  const normalized = normalizeDocumentLayout(layout);
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const current = await readFirmMetadataForMerge(admin, firmId);
  if (!current.ok) return { ok: false, error: current.error };
  const { error } = await admin
    .from('firms')
    .update({
      metadata: {
        ...current.metadata,
        [DOCUMENT_LAYOUT_METADATA_KEY]: normalized,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

/** Go back to the layout the renderer had before any of it was configurable.
 *  The key is removed rather than written as the default, so a firm that has
 *  never configured one and a firm that has reset are the same firm. */
export async function removeFirmDocumentLayoutAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: DOCUMENT_LAYOUT_DENIED };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const current = await readFirmMetadataForMerge(admin, firmId);
  if (!current.ok) return { ok: false, error: current.error };
  const next = { ...current.metadata };
  delete next[DOCUMENT_LAYOUT_METADATA_KEY];
  const { error } = await admin
    .from('firms')
    .update({ metadata: next, updated_at: new Date().toISOString() })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

/**
 * Read an existing letterhead out of a document the firm already has, and
 * PROPOSE it. This never writes.
 *
 * The separation is the point. What comes back is a reading of a document, and
 * a reading can be wrong in ways only the legal team can see: a former address
 * still printed on an old template, a partner who has left, a bar admission
 * that has lapsed. So the proposal goes into the designer's fields for someone
 * to correct, and saving stays a deliberate act through
 * saveFirmLetterheadDesignAction above.
 */
export async function importFirmLetterheadAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; design?: LetterheadDesign }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: LETTERHEAD_DESIGN_DENIED };
  }
  const file = formData.get('letterheadDocument');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a PDF or Word document.' };
  }
  if (file.size > LETTERHEAD_IMPORT_MAX_BYTES) {
    return { ok: false, error: 'The document must be under 15 MB.' };
  }
  if (!/\.(pdf|docx)$/i.test(file.name)) {
    return { ok: false, error: 'Use a PDF or a Word (.docx) document.' };
  }

  // Imported here rather than at the top of the file so the PDF and Word
  // parsers, and the Anthropic client, stay out of the module graph of every
  // other action in this file.
  const { extractFileText } = await import('./doc-review');
  const extracted = await extractFileText(file).catch(() => null);
  const head = (extracted?.text ?? '').slice(0, LETTERHEAD_IMPORT_CHARS).trim();
  if (!head) {
    return {
      ok: false,
      error:
        'We could not read any text from that document. If it is a scan or an image, fill the fields in below instead.',
    };
  }

  let reply: string;
  try {
    // Inside the try, not above it. A dynamic import can fail on its own (a
    // chunk that did not ship, a module that throws while initializing), and
    // an import that throws out of a server action is an unhandled server
    // error rather than the calm string every other path here returns.
    const { bellaGenerate } = await import('./bella');
    reply = await bellaGenerate({
      system:
        'You read the letterhead out of the top of a legal document. Reply with a single JSON object and nothing else. ' +
        'Use exactly these keys: firmName (string), addressLines (array of up to 4 strings), phone (string), ' +
        'email (string), website (string), admissionsLine (string, any bar admissions or registered office line). ' +
        'Use an empty string or an empty array for anything the document does not state. Copy the values verbatim ' +
        'from the document and invent nothing. If the text carries no letterhead, reply with {}.',
      prompt: `Here is the top of the document:\n\n${head}`,
      maxTokens: 700,
    });
  } catch (err) {
    // The sentence below is the DEFAULT. Only AiUnavailableError, whose copy
    // was written for a person, gets to speak for itself; see calmAiMessage
    // for why the obvious inverse of this leaks the configuration error
    // bellaGenerate throws before it ever calls out.
    return {
      ok: false,
      error: calmAiMessage(
        err,
        'The letterhead reader is unavailable right now. Fill the fields in below instead.',
      ),
    };
  }

  const design = parseLetterheadDesignReply(reply);
  if (!design) {
    return {
      ok: false,
      error:
        'We could not find a letterhead in that document. Fill the fields in below instead.',
    };
  }
  return { ok: true, design };
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
  // Key presence, not `?? null`, and this is the one path that consumes a
  // seat. `?? null` reads a row that lacks the column as "no limit", which is
  // the fail-open direction: every seat check below would pass. PostgREST
  // errors an unknown column rather than returning a row without it, so this
  // is not a live hole; it is the same rule the trial readers in
  // lib/firm-trials.ts hold, that a reader does not get to assume its caller's
  // honesty about the shape it was handed.
  const seatRow = seatFirm as Record<string, unknown> | null;
  if (seatRow && !('seat_limit' in seatRow)) {
    console.error(
      'acceptFirmInvitationAction: the firms row came back without seat_limit, so the seat limit could not be checked.',
    );
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  const seatLimit = (seatRow?.seat_limit as number | null | undefined) ?? null;
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
  //
  // CONFIRMED, not assumed. PostgREST resolves rather than throws, so an
  // insert that wrote nothing used to return here indistinguishable from one
  // that wrote a row, and the three writes below then reported a firm the
  // caller had not actually joined. `alreadyAMember` is what makes the
  // idempotent case still pass: re-accepting an invitation trips the UNIQUE
  // constraint and returns no row, which is a success for someone who is
  // already inside and the only failure that matters for anyone else.
  const { data: memberRow, error: memberErr } = await admin
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
  if (!memberRow && !alreadyAMember) {
    console.error(
      'acceptFirmInvitationAction: the membership row was not created',
      memberErr?.message,
    );
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  // Add the new member to the default #general channel if it exists.
  //
  // Deliberately the one write here that is NOT fatal. Not every firm has a
  // default channel, a re-accept trips the same UNIQUE constraint as above,
  // and refusing an otherwise complete membership over a chat convenience
  // would strand a person who has in fact joined. Logged so a systemic
  // failure is still visible.
  const { data: defaultChan } = await admin
    .from('firm_channels')
    .select('id')
    .eq('firm_id', invRow.firm_id)
    .eq('is_default', true)
    .maybeSingle();
  if (defaultChan) {
    const { error: chanErr } = await admin
      .from('firm_channel_members')
      .insert({
        channel_id: (defaultChan as { id: string }).id,
        user_id: user.id,
      })
      .select('id')
      .maybeSingle();
    if (chanErr) {
      console.error(
        'acceptFirmInvitationAction: could not add the new member to #general',
        chanErr.message,
      );
    }
  }
  // Activate the firm for the user. A profiles row exists for every auth user
  // (handle_new_user creates one on signup), so matching none means the read
  // this action is about to report is not the one the caller will land on.
  const { data: activated } = await admin
    .from('profiles')
    .update({ active_firm_id: invRow.firm_id })
    .eq('id', user.id)
    .select('id');
  if ((activated ?? []).length === 0) {
    console.error(
      'acceptFirmInvitationAction: no profiles row to activate the firm on',
    );
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  // Marked used LAST, and confirmed. Consuming the invitation is the step that
  // cannot be retried, so it goes after everything that can: if any write
  // above refuses, the invitation is still live and the caller can simply try
  // again, which the seat check and `alreadyAMember` above make idempotent.
  const { data: consumed } = await admin
    .from('firm_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invRow.id)
    .select('id');
  if ((consumed ?? []).length === 0) {
    console.error(
      'acceptFirmInvitationAction: the invitation could not be marked as used',
    );
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
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
// Deciding a request: decline it, close it out, put it back
// =====================================================================

/**
 * What is stored on the request when the firm decides it.
 *
 * It lives in `intake_answers`, the schema-less column this table already
 * uses for the reminder, the folder and the filed attachments, so nothing
 * here needs a migration. `previousStatus` is the only field the code reads
 * back; the rest is the firm's record and what the two pages render.
 */
type StoredIntakeDecision = {
  outcome: IntakeDecision;
  reason: string;
  byUserId: string;
  byName: string;
  at: string;
  previousStatus: string;
};

/**
 * Move a request out of the queue, or put it back, and tell the person who
 * filed it.
 *
 * WHY THIS EXISTS. `firm_matter_intakes.status` allowed seven values and only
 * two were ever written. `engaged`, `rejected` and `closed` were declared in
 * the CHECK constraint, mapped into lanes, coloured, and counted, and no code
 * path could reach any of them. The cost landed on the employee rather than
 * on the firm: lib/portal-open-requests.ts calls a request decided when it is
 * `rejected` or `closed`, so with no writer for either, "You have N requests
 * open with your legal team" could only ever grow, and a request declined in
 * a meeting stayed open on the employee's home page forever.
 *
 * Four properties, each of which is a defect this repo has already paid for.
 *
 *   - AUTHORIZED THROUGH lib/firm-authz, the only firm authorization axis.
 *     Every export of this module is a public HTTP endpoint callable with
 *     arguments of the caller's choosing, and the write below goes through
 *     the service-role client, which bypasses RLS entirely. Which button
 *     renders is not a gate. FIRM_MANAGE_ROLES is owner/admin/attorney: the
 *     set that already decides whether the firm takes work on, since this
 *     writes a refusal in the firm's name and the requester is told about it.
 *
 *   - CONFIRMED. `.select('id')` is what separates "wrote a row" from
 *     "matched nothing". postgrest-js resolves an UPDATE that matches zero
 *     rows with `error: null`, so an unconfirmed write reports success for a
 *     change that did not happen. That exact shape has silently dropped
 *     writes across this codebase; nothing here is reported as ok, and no
 *     record is written, until a row comes back.
 *
 *   - RECORDED, the way this product already records decisions on a request.
 *     Assignment, invitation and document requests each post an event into
 *     firm_intake_messages, which is the request's permanent trail and is
 *     what both the counsel page and the employee's portal page show. A
 *     decision on a legal matter is recorded the same way, with the reason in
 *     it. insertIntakeMessage returns null rather than throwing when that
 *     insert fails, because supabase-js resolves with `{ error }`; the null
 *     is checked, and the caller is told, rather than the record quietly
 *     going missing while the status moves.
 *
 *   - REVERSIBLE. A request closed by mistake with no way back would be a new
 *     trap replacing the old one. reopenIntakeAction restores the status the
 *     request held before the decision, and the decision event stays on the
 *     trail so the record shows both that it happened and that it was undone.
 *
 * Returns rather than throws on refusal, for the reason
 * app/counsel/cases/set-status.ts gives: a thrown server action replaces the
 * surrounding surface with an error boundary instead of telling the control
 * what happened. requireActiveFirm still throws, and the client calls this
 * through runGatedAction, which is what turns that one into calm copy.
 */
export async function decideIntakeAction(
  firmId: string,
  intakeId: string,
  decision: string,
  reason: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const outcome = decision as IntakeDecision;
  const status = INTAKE_DECISIONS[outcome];
  if (!status) {
    return { ok: false, error: 'That is not a decision a request can carry.' };
  }
  if (!(await callerHasFirmRole(firmId, FIRM_MANAGE_ROLES))) {
    return {
      ok: false,
      error: 'Only firm owners, admins or attorneys can decide a request.',
    };
  }
  await requireActiveFirm(firmId);

  const note = String(reason ?? '').trim().slice(0, INTAKE_DECISION_NOTE_MAX);
  // Required on a decline, optional on a close-out. A person reading "your
  // request was declined" with nothing after it has been told less than
  // nothing, and the firm's own record of a refusal should say why. A
  // close-out is usually "you withdrew it" or "handled elsewhere", where
  // insisting on a sentence would only produce a filler one.
  if (outcome === 'declined' && note.length === 0) {
    return {
      ok: false,
      error: 'Add a short reason. The person who filed this will read it.',
    };
  }

  const { data: row } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('id', intakeId)
    .maybeSingle();
  const intake = (row as IntakeRow | null) ?? null;
  if (!intake || intake.firm_id !== firmId) {
    return { ok: false, error: 'Request not found.' };
  }
  if (intake.status === status) return { ok: true };

  const at = new Date().toISOString();
  const byName = await firmActorName(admin, user.id);
  const stored: StoredIntakeDecision = {
    outcome,
    reason: note,
    byUserId: user.id,
    byName,
    at,
    previousStatus: intake.status,
  };
  const answers = { ...(intake.intake_answers ?? {}), decision: stored };

  // `.eq('firm_id', firmId)` alongside the id is belt and braces: firmId was
  // read off the request just above, so the two cannot disagree, but it keeps
  // the write inside the firm the caller was actually authorized for.
  const { data: written, error } = await admin
    .from('firm_matter_intakes')
    .update({ status, intake_answers: answers, updated_at: at })
    .eq('id', intakeId)
    .eq('firm_id', firmId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!written || written.length === 0) {
    return {
      ok: false,
      error: 'That decision could not be saved. Nothing on the request has changed.',
    };
  }

  // Only now. The row moved, so the trail is describing something that
  // happened rather than something that was attempted.
  const recorded = await recordIntakeDecisionEvent({
    admin,
    intake: { ...intake, status },
    authorUserId: user.id,
    authorName: byName,
    eventType: 'decision_recorded',
    body:
      outcome === 'declined'
        ? `${byName} declined this request.${note ? `\n\nReason: ${note}` : ''}`
        : `${byName} closed this request out.${note ? `\n\nNote: ${note}` : ''}`,
  });

  return recorded
    ? { ok: true }
    : {
        ok: true,
        warning:
          'The decision was saved, but it could not be added to the request trail. Tell the requester directly.',
      };
}

/**
 * Put a decided request back on the queue.
 *
 * Same gate, same confirmation, same trail. The status restored is the one
 * the request held before the decision; anything unrecognised or itself
 * decided falls back to the queue rather than to a lane nobody watches. The
 * stored decision is cleared so the pages stop reporting a decision that no
 * longer holds, and the two events stay on the trail, which is where the
 * record of both the decision and the reversal lives.
 */
export async function reopenIntakeAction(
  firmId: string,
  intakeId: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  if (!(await callerHasFirmRole(firmId, FIRM_MANAGE_ROLES))) {
    return {
      ok: false,
      error: 'Only firm owners, admins or attorneys can reopen a request.',
    };
  }
  await requireActiveFirm(firmId);

  const { data: row } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('id', intakeId)
    .maybeSingle();
  const intake = (row as IntakeRow | null) ?? null;
  if (!intake || intake.firm_id !== firmId) {
    return { ok: false, error: 'Request not found.' };
  }
  if (!DECIDED_INTAKE_STATUSES.includes(intake.status as never)) {
    return { ok: false, error: 'This request is already open.' };
  }

  const answers = { ...(intake.intake_answers ?? {}) };
  const prior = (answers.decision ?? null) as StoredIntakeDecision | null;
  delete answers.decision;
  const status = reopenedIntakeStatus(prior?.previousStatus);

  const at = new Date().toISOString();
  const { data: written, error } = await admin
    .from('firm_matter_intakes')
    .update({ status, intake_answers: answers, updated_at: at })
    .eq('id', intakeId)
    .eq('firm_id', firmId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!written || written.length === 0) {
    return {
      ok: false,
      error: 'That could not be saved. The request is still closed.',
    };
  }

  const byName = await firmActorName(admin, user.id);
  const recorded = await recordIntakeDecisionEvent({
    admin,
    intake: { ...intake, status },
    authorUserId: user.id,
    authorName: byName,
    eventType: 'decision_reopened',
    body: `${byName} reopened this request. It is back with the legal team.`,
  });

  return recorded
    ? { ok: true }
    : {
        ok: true,
        warning:
          'The request was reopened, but it could not be added to the request trail.',
      };
}

/** The display name the conversation already shows for a firm member. */
async function firmActorName(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  userId: string,
): Promise<string> {
  const people = await hydratePeople(admin, [userId]);
  return people.get(userId)?.name ?? 'The legal team';
}

/**
 * Post the decision onto the request's trail.
 *
 * `authorRole: 'legal'` rather than `'system'` is load-bearing and not
 * cosmetic: a person decided this, and notifyIntakeActivity routes a shared
 * legal-authored message to the requester, where a system-authored one goes
 * to the legal team only. Getting that wrong would announce the decision to
 * everyone except the one person it is about.
 *
 * Returns false when nothing was written. insertIntakeMessage inspects the
 * postgrest result and returns null on failure, because supabase-js resolves
 * with `{ error }` rather than throwing and a try/catch around it would catch
 * nothing at all.
 */
async function recordIntakeDecisionEvent(input: {
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>;
  intake: IntakeRow;
  authorUserId: string;
  authorName: string;
  eventType: string;
  body: string;
}): Promise<boolean> {
  const message = await insertIntakeMessage({
    admin: input.admin,
    intake: input.intake,
    authorUserId: input.authorUserId,
    authorName: input.authorName,
    authorRole: 'legal',
    visibility: 'shared',
    body: input.body,
    kind: 'event',
    eventType: input.eventType,
  });
  if (!message) {
    console.error(
      `[intake-decision] request ${input.intake.id} moved to ${input.intake.status} but the trail entry was not written`,
    );
  }
  revalidateIntake(input.intake.id);
  revalidatePath('/counsel');
  return Boolean(message);
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

  // INTAKE_COLS rather than the four fields this used to read: the meeting
  // is announced with insertIntakeMessage below, which wants the whole row.
  const { data: row } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('id', intakeId)
    .maybeSingle();
  const intake = (row as IntakeRow | null) ?? null;
  if (!intake || intake.firm_id !== firmId) {
    return { ok: false, error: 'Request not found.' };
  }

  const title =
    String(formData.get('title') ?? '').trim() ||
    // client_name is nullable, which the old cast hid: an unnamed request
    // put the word "null" in the calendar invite the requester receives.
    `Advottic: ${intake.client_name?.trim() || 'legal request'}`;
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

  // Post the meeting into the conversation, and notify the requester.
  //
  // This is the request's live conversation: a row in firm_intake_messages,
  // the same table postIntakeMessageAction writes and the panel reads. It
  // used to append to the `intake_answers.thread` jsonb array the
  // conversation left behind in 20260727_intake_conversation.sql, so the one
  // message on the ticket the requester most needs to see - the join link -
  // was written where nothing reads.
  //
  // 'legal' rather than 'system' for the same reason as the decision trail
  // above: a person scheduled this, and it is the requester who is being
  // told. See recordIntakeDecisionEvent.
  const byName = await firmActorName(admin, user.id);
  const when = formatDateTimeNumeric(startMs);
  const providerLabel =
    result.provider === 'microsoft' ? 'Microsoft Teams' : 'Zoom';
  const posted = await insertIntakeMessage({
    admin,
    intake,
    authorUserId: user.id,
    authorName: byName,
    authorRole: 'legal',
    visibility: 'shared',
    body: `${providerLabel} meeting scheduled for ${when} (${durationMin} min).\nJoin: ${result.joinUrl}`,
    kind: 'event',
    eventType: 'meeting_scheduled',
  });
  if (!posted) {
    console.error(
      `[intake-meeting] request ${intakeId} has a ${result.provider} meeting but the conversation entry was not written`,
    );
  }

  // The requester's own notification, not notifyIntakeActivity: the meeting
  // already has a typed notification with its own copy, and fanning the
  // message out as well would ring the same person twice for one meeting.
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

  revalidateIntake(intakeId);
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
  const whenText = formatDateWith(startMs, {
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

/**
 * One signer's outgoing mail that the provider did not accept.
 *
 * `kind` is 'link' for the branded sign link and 'code' for the separate
 * one-time access code an external signer needs to open the document. A
 * signer who is missing either one cannot complete the signature, so both
 * have to reach the caller by name rather than being swallowed.
 */
export type SigningEmailFailure = {
  email: string;
  kind: 'link' | 'code';
  error: string;
  /** Who wrote `error`. See SigningErrorSource. */
  source: SigningErrorSource;
};

/**
 * Who wrote a sentence a signing action hands back.
 *
 * 'app' is our own copy, written here in English, which the counsel
 * shell passes through t() so a firm working in another language reads
 * it in theirs. 'provider' is text we did not write, from the mail
 * provider or the store, which is shown verbatim inside
 * `data-no-translate`: machine-translating a provider diagnostic
 * destroys the one thing it is good for, which is being quoted back to
 * the provider.
 *
 * Without this the UI cannot tell the two apart, so every sentence on
 * this channel has to be treated as untranslatable, and our own copy
 * renders in English on a non-English locale.
 */
export type SigningErrorSource = 'app' | 'provider';

/**
 * The bucket key for one recipient, with any plus tag folded away.
 *
 * `victim+1@example.com` and `victim+2@example.com` are two addresses
 * and one inbox, and nothing on the create path validates an address,
 * let alone limits how many spellings of one inbox a caller may name.
 * Keyed literally, a budget on the address is walked around by typing a
 * different number after the plus.
 *
 * This is only a throttle key. It is never used as a delivery address,
 * so folding costs a firm that legitimately plus-tags per matter
 * nothing worse than those tags sharing one allowance, which is the
 * same allowance the untagged address would have had on its own.
 */
function recipientBucketKey(normalizedEmail: string): string {
  const at = normalizedEmail.lastIndexOf('@');
  if (at <= 0) return normalizedEmail;
  const local = normalizedEmail.slice(0, at);
  const plus = local.indexOf('+');
  return plus > 0 ? `${local.slice(0, plus)}${normalizedEmail.slice(at)}` : normalizedEmail;
}

/**
 * Is this address inside the budget of signing mail one inbox may get?
 *
 * The per-signature bucket in resendSigningEmailsAction answers "is this
 * one signer being hammered". It cannot answer "is this INBOX being
 * hammered", because every new signing request mints a new signature id
 * and therefore a brand-new bucket: name the same address on request
 * after request, up to eight signers at two messages each, and the
 * per-signature limit is never approached. Creating a request is a
 * paralegal-level action, so that path needs a cap of its own.
 *
 * What this buys, precisely: one inbox takes at most six signing
 * messages from us in ten minutes, however many requests or signatures
 * they are spread across, and whatever letter case, surrounding
 * whitespace or plus tag the address was typed with.
 *
 * Those are the only spellings folded. A dotted Gmail local part
 * (`v.ictim@`), a subaddress separator that is not a plus
 * (`victim-tag@` on Fastmail), and a domain alias (`gmail.com` against
 * `googlemail.com`) all reach the same inbox and each still gets a
 * bucket of its own. Folding them is deliberately not attempted: the
 * rules are per-provider, and guessing wrong merges two genuinely
 * different people into one allowance, which is a worse failure than
 * the one it would prevent.
 *
 * What it does NOT buy is the standing of the sending domain.
 * createSigningRequestAction has no per-firm and no global outbound cap,
 * so an abuser who keeps naming DISTINCT addresses is never throttled
 * by anything here, and it is the volume across distinct addresses that
 * a mailbox provider judges a domain on. A cap on that is a separate
 * decision with its own blast radius (it can refuse legitimate bulk
 * work) and is deliberately not made here.
 *
 * Deliberately NOT scoped to the firm. A per-firm bucket would multiply
 * the allowance by the number of firms an abuser controls, and what is
 * being spent, a person's patience with our mail, is not any one
 * tenant's to spend. The cost is that two firms mailing the same
 * address in the same ten minutes share the budget, which the window is
 * wide enough to absorb for ordinary work (a send, a resend or two, a
 * second document) and which fails as an honest error on a request that
 * stays fully recoverable.
 *
 * Fails closed, like the other outbound-mail buckets: a caller who can
 * induce store errors must not be handed an uncapped mailer.
 */
async function withinRecipientMailBudget(normalizedEmail: string): Promise<boolean> {
  return checkRateLimit(`signing-recipient:${recipientBucketKey(normalizedEmail)}`, {
    limit: 6,
    windowSeconds: 600,
    failClosed: true,
  });
}

/**
 * Move a signing request out of `draft`, and say so in the audit chain.
 *
 * Both the create path and the recovery path land here, on the same
 * fact: the sign link was accepted for at least one signer. Until it
 * runs the row reads "Draft, not yet sent" - the truth for a request
 * whose every email was refused, and a lie for one a resend has since
 * put in a signer's hands. The lie is not cosmetic: every view that
 * filters on status in ('sent', 'partial'), including the assistant's
 * answer to "what is outstanding" (lib/bella.ts), reports that nothing
 * is out for signature on a request that genuinely is.
 *
 * `request_sent` is emitted here rather than beside `request_created`
 * for the same reason. `request_created` fires for a row that may never
 * be sent, so on its own the chain cannot tell an auditor "created,
 * never sent" from "created and sent" even though the status column now
 * can. Emitting it at the moment of promotion is what keeps the two
 * agreeing.
 *
 * The promotion is conditional on the row still being a `draft`, for
 * the same reason the code rotation is conditional on the hash it read.
 * Both callers decide to promote from a status they read at the top of
 * the action, and both are public endpoints: two resends for the same
 * draft request, whether the same signer twice or two signers of one
 * request, would otherwise both send a link, both promote, and leave
 * two `request_sent` events in the evidence chain with the second
 * `sent_at` overwriting the first. Matching on 'draft' means the loser
 * of that race touches nothing. It costs no extra round trip, and it is
 * safe on the create path, where the row was just inserted as a draft.
 */
async function markSigningRequestSent(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  input: {
    requestId: string;
    documentId: string;
    userId: string;
    documentSha256?: string | null;
    /** What the auditor needs to know about this particular send. */
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: promoted } = await admin
    .from('firm_signing_requests')
    .update({ status: 'sent' as FirmSigningStatus, sent_at: nowIso })
    .eq('id', input.requestId)
    .eq('status', 'draft')
    .select('id');
  // Zero rows means somebody else promoted this request first. They
  // already moved the document and appended the event, so there is
  // nothing left to do and nothing to report: the mail this caller sent
  // is still recorded, by reminder_sent on the resend path.
  if (((promoted as Array<{ id: string }> | null) ?? []).length === 0) return;
  // The document follows the request: it moves into the signer's hands
  // only once something reached a signer. The operator can advance it to
  // a signed_* state once execution happens, or back to 'pending' if a
  // counterparty needs more time.
  await admin
    .from('firm_documents')
    .update({ status: 'sent', status_updated_at: nowIso })
    .eq('id', input.documentId)
    .in('status', ['submitted', 'received', 'ready', 'pending', 'on_hold']);
  const { appendSignatureEvent } = await import('./esign-audit');
  await appendSignatureEvent(admin, {
    signingRequestId: input.requestId,
    eventType: 'request_sent',
    userId: input.userId,
    ...(input.documentSha256 ? { documentSha256: input.documentSha256 } : {}),
    metadata: input.metadata,
  }).catch(() => {});
}

export async function createSigningRequestAction(
  firmId: string,
  documentId: string,
  signers: Array<{
    email: string;
    name?: string;
    positionPage?: number;
    positionX?: number;
    positionY?: number;
    /**
     * Where this signer sits in the sequence, or omitted for "no order",
     * which is what every caller but the template dispatch passes and
     * what every request did before this existed: everyone at once.
     * A numbered signer is emailed only once every lower number has
     * signed, and lib/signature-write.ts refuses their signature until
     * then, so the sequence is enforced and not merely presented.
     */
    order?: number | null;
  }>,
  message: string | null,
  options?: {
    /**
     * Whether the signer may download a copy of what they signed.
     * Omitted means permitted: that is the default the composer shows
     * and the default the column carries.
     */
    signerCanDownload?: boolean;
    /**
     * Which signature methods this request may be signed with, frozen from the
     * dispatching template. Omitted (every caller but the template dispatch)
     * means no restriction, which is what every request has meant until now.
     *
     * lib/signature-write.ts reads the stored column and refuses a signature
     * made any other way, so this is the moment the firm's choice becomes
     * enforceable. It is frozen rather than joined at signing time on purpose:
     * a counterparty may hold the link for weeks, and a template edited while
     * they held it must not retroactively change the ceremony they were
     * invited to.
     */
    signatureMethods?: SignatureMethod[] | null;
  },
): Promise<{
  ok: boolean;
  error?: string;
  requestId?: string;
  /** Who wrote `error`, when there is one. See SigningErrorSource. */
  errorSource?: SigningErrorSource;
  /**
   * Non-empty when the request row was created but at least one email
   * did not leave. The record and its tokens are valid and a resend is
   * cheap, so we keep the request rather than discarding signed-URL
   * work and audit events over a mail-provider problem - but the caller
   * MUST NOT report a plain success when this is set. See
   * resendSigningEmailsAction for the recovery path.
   */
  emailFailures?: SigningEmailFailure[];
}> {
  const user = await requireUser();
  if (signers.length === 0)
    return { ok: false, error: 'Add at least one signer.', errorSource: 'app' };
  const supabase = createServerSupabase();
  const admin = createAdminSupabase();
  if (!admin)
    return {
      ok: false,
      error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.',
      errorSource: 'app',
    };

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
        errorSource: 'app',
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
    return { ok: false, error: 'Document not found for this firm.', errorSource: 'app' };
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

  // Whether the signer keeps a copy. Default permitted - see
  // parseSignerDownloadPermission and the migration that adds the
  // column for why silence means yes.
  const signerCanDownload = options?.signerCanDownload !== false;

  const requestInsert = {
    firm_id: firmId,
    document_id: documentId,
    requested_by: user.id,
    message,
    // Created, not sent. The row opens as a draft with no sent_at and is
    // promoted by markSigningRequestSent below, once the provider has
    // actually accepted mail for at least one signer. Writing 'sent'
    // here meant that if every send failed the firm still read
    // "Awaiting signatures" on a request nobody had ever been told
    // about, the same defect the audit chain was just fixed for, one
    // layer down.
    status: 'draft' as FirmSigningStatus,
    document_sha256: documentSha256,
  };
  let downloadPermissionPersisted = true;
  // Named only when there IS a restriction, so a request that restricts
  // nothing never touches a column that may not exist yet.
  const signatureMethods = options?.signatureMethods ?? null;
  const methodsExtra = signatureMethods
    ? { signature_methods: signatureMethods }
    : {};
  let { data: req, error: reqErr } = await supabase
    .from('firm_signing_requests')
    .insert({
      ...requestInsert,
      ...methodsExtra,
      signer_can_download: signerCanDownload,
    })
    .select('id')
    .single();
  // The column arrives with a migration the owner applies, and there is
  // a further window right after it runs while PostgREST still holds a
  // stale schema cache. Sending without the column is fine when
  // downloads were ALLOWED, because that is what the reader falls back
  // to anyway. It is not fine when the firm restricted them: that
  // would send the request with the document downloadable by exactly
  // the person the firm chose to withhold it from. So that case
  // aborts. The decision is resolveDownloadColumnFallback, unit-tested
  // in lib/signer-view.ts, and it is narrowly scoped to a missing
  // column so a permission or constraint failure still surfaces.
  if (reqErr) {
    // The method restriction is checked first and aborts, for the reason the
    // download restriction below aborts: sending without it would put the
    // document in front of the counterparty accepting exactly the ways of
    // signing the firm refused, and nothing about that is recoverable once
    // they have signed. Clearing is not a case here, since a null restriction
    // never names the column at all.
    if (
      resolveSignatureMethodsColumnFallback({
        methods: signatureMethods,
        error: reqErr,
      }) === 'abort-restriction-unsaved'
    ) {
      return {
        ok: false,
        error: SIGNATURE_METHODS_UNSAVED_ERROR,
        errorSource: 'app',
      };
    }
    const fallback = resolveDownloadColumnFallback({
      signerCanDownload,
      error: reqErr,
    });
    if (fallback === 'abort-restriction-unsaved') {
      return {
        ok: false,
        error: SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR,
        errorSource: 'app',
      };
    }
    if (fallback === 'retry-without-column') {
      downloadPermissionPersisted = false;
      ({ data: req, error: reqErr } = await supabase
        .from('firm_signing_requests')
        .insert({ ...requestInsert, ...methodsExtra })
        .select('id')
        .single());
    }
  }
  if (reqErr || !req) {
    // The store's own wording when there is one, ours when there is not.
    return reqErr?.message
      ? { ok: false, error: reqErr.message, errorSource: 'provider' }
      : { ok: false, error: 'Could not create request.', errorSource: 'app' };
  }
  const requestId = (req as { id: string }).id;

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
      // What the firm chose about the signer keeping a copy, and
      // whether that choice actually reached the row. An auditor
      // reading a request sent before the column existed can tell the
      // difference between "permitted" and "could not be restricted".
      signer_can_download: signerCanDownload,
      signer_can_download_persisted: downloadPermissionPersisted,
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

  // Every send that the provider did not accept, by signer. Collected
  // rather than discarded: sendEmail returns ok:false for a missing
  // RESEND_API_KEY, an unverified sending domain, a provider error and a
  // timeout alike, and dropping that result made this action report
  // success while nothing was ever delivered.
  const emailFailures: SigningEmailFailure[] = [];
  // Whether the sign link reached anyone. Counting failures is not the
  // same question: an external signer contributes up to two failures, so
  // a per-signer count would misread one bad address among several as a
  // total wash.
  let anySignerReached = false;

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
    const signatureInsert = {
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
    };
    const wantsOrder = typeof signer.order === 'number';
    let { data: sigRow, error: sigErr } = await admin
      .from('firm_signatures')
      .insert(
        wantsOrder
          ? { ...signatureInsert, signer_order: signer.order }
          : signatureInsert,
      )
      .select('id')
      .single();
    // signer_order arrives with a migration the owner applies, and there
    // is a further window after it runs while PostgREST still holds a
    // stale schema cache. Retrying without the column is the right
    // recovery here, and in the opposite direction to the download
    // permission above: dropping THAT column would have inverted a
    // confidentiality decision, whereas dropping this one lands on
    // "everyone at once", which is precisely the behaviour this product
    // had last week and still has for every unordered request. So the
    // fallback is a downgrade to today, not a leak.
    //
    // orderPersisted is then carried into the mail decision below. A
    // signer whose order was NOT recorded must be emailed now, because
    // nothing later will know they were meant to wait, and a signer who
    // is never told is worse than one told early.
    let orderPersisted = wantsOrder;
    if (sigErr && wantsOrder && isUnknownColumnError(sigErr, 'signer_order')) {
      orderPersisted = false;
      ({ data: sigRow, error: sigErr } = await admin
        .from('firm_signatures')
        .insert(signatureInsert)
        .select('id')
        .single());
    }
    const signatureId = (sigRow as { id?: string } | null)?.id ?? null;

    const url = `${baseUrl}/sign/${token}`;

    // Whose turn it is, at the moment the request is created.
    //
    // Nobody has signed yet, so this is decided entirely by the numbers
    // the caller passed: the unordered signers and the lowest number are
    // ready, and everybody else waits. lib/signer-order.ts is the same
    // rule the write and the page run, so what the email loop believes
    // and what the write enforces cannot drift apart.
    //
    // A waiting signer is skipped ENTIRELY here: no link email, no
    // in-app notification, and no entry in emailFailures, because
    // nothing failed. Their row, their token and their access code hash
    // all exist, and lib/signature-write.ts mails them the link the
    // moment the person ahead of them signs.
    const turn = orderPersisted
      ? resolveSignerTurn(
          placedSigners.map((s) => ({
            order: typeof s.order === 'number' ? s.order : null,
            signedAt: null,
          })),
          placedSigners.indexOf(signer),
        )
      : 'ready';

    // The per-recipient budget (see withinRecipientMailBudget). Checked
    // after the signature row exists, so an address that is over it
    // leaves a recoverable request rather than a missing signer: the
    // token is live, the request stays a draft, and a resend once the
    // window has passed delivers it. Nothing goes to this address until
    // then, in-app notification included, since that producer emails too.
    if (!(await withinRecipientMailBudget(normalizedEmail))) {
      emailFailures.push({
        email: normalizedEmail,
        kind: 'link',
        error:
          'This address has already had several signing emails in the last few minutes. Use Resend on this signer shortly.',
        source: 'app',
      });
      continue;
    }

    if (signerUserId && turn === 'ready') {
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

    // Email 1: the branded sign link. Held back for a signer whose turn
    // has not come; lib/signature-write.ts sends exactly this message,
    // from exactly this function, when the person ahead of them signs.
    if (turn === 'ready') {
      const linkResult = await sendSigningLinkEmail({
        to: signer.email,
        firmName,
        firmLogo,
        senderName,
        docName,
        message,
        url,
        isExternal,
      });
      if (linkResult.ok) {
        anySignerReached = true;
      } else {
        emailFailures.push({
          email: normalizedEmail,
          kind: 'link',
          error: linkResult.error,
          source: 'provider',
        });
      }
    }

    // Email 2 (external only): the one-time access code.
    //
    // Sent now even for a signer whose turn has not come, and that is a
    // decision rather than an oversight. The code opens nothing on its
    // own: it is checked against a link the holder does not have yet.
    // Minting a fresh one when their turn arrives would invalidate the
    // one already in their inbox, and re-sending the same one is
    // impossible because only its hash is stored. So the code goes once,
    // here, and the access_code_sent event records the moment it
    // actually happened, which is the only moment it may record.
    if (isExternal && accessCode) {
      const codeResult = await sendSigningCodeEmail({
        to: signer.email,
        firmName,
        firmLogo,
        docName,
        code: accessCode,
      });
      if (!codeResult.ok) {
        emailFailures.push({
          email: normalizedEmail,
          kind: 'code',
          error: codeResult.error,
          source: 'provider',
        });
      }
      // Only record "we sent the code" once the provider actually took
      // it. The audit chain is evidence; it must not assert a delivery
      // that never happened.
      if (signatureId && codeResult.ok) {
        await appendSignatureEvent(admin, {
          signingRequestId: requestId,
          signatureId,
          eventType: 'access_code_sent',
          signerEmail: normalizedEmail,
        }).catch(() => {});
      }
    }
  }

  // Promote the request out of draft only now, and only if at least one
  // signer was actually reached. A request whose every email was refused
  // stays a draft with no sent_at: the sign tokens are live, so a resend
  // recovers it, but nothing in the product claims a delivery that never
  // happened.
  if (anySignerReached) {
    await markSigningRequestSent(admin, {
      requestId,
      documentId,
      userId: user.id,
      documentSha256,
      metadata: { sent_by: 'request', signer_count: placedSigners.length },
    });
  }

  revalidatePath('/counsel/signing');
  revalidatePath(`/counsel/documents/${documentId}`);
  return {
    ok: true,
    requestId,
    ...(emailFailures.length > 0 ? { emailFailures } : {}),
  };
}

/** The separate one-time access code email for an external signer. */
async function sendSigningCodeEmail(input: {
  to: string;
  firmName: string;
  firmLogo: string | null;
  docName: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await sendEmail({
    to: input.to,
    fromName: input.firmName,
    subject: `${input.firmName}: your access code for ${input.docName}`,
    html: buildSigningCodeEmailHtml({
      firmName: input.firmName,
      logoUrl: input.firmLogo,
      documentName: input.docName,
      code: input.code,
    }),
    text:
      `Your one-time access code for "${input.docName}" is: ${input.code}\n\n` +
      'Enter it on the sign page from your other email to open the document. Never share this code.',
  }).catch((err: unknown) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : 'unknown email error',
  }));
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Re-send the signing emails for one signer.
 *
 * The recovery path for a request whose mail did not leave the building.
 * Nothing about the signature row changes except the access code: the
 * plaintext of the original was never stored (only its hash), so an
 * external signer gets a freshly minted code and the old one stops
 * working. The sign token is untouched, so any link already in the
 * signer's hands stays valid.
 *
 * Because it rotates the credential, this is a recovery action and not a
 * nudge: an outside signer who had already entered their code is asked
 * for the new one the next time they open the link. The button copy says
 * so (app/counsel/signing/[id]/resend-button.tsx).
 *
 * If the request was still a draft (every original email refused) and
 * the link now reaches the signer, this is also where it stops being a
 * draft. See markSigningRequestSent.
 */
export async function resendSigningEmailsAction(
  firmId: string,
  signatureId: string,
): Promise<{
  ok: boolean;
  error?: string;
  /** Who wrote `error`, when there is one. See SigningErrorSource. */
  errorSource?: SigningErrorSource;
  emailFailures?: SigningEmailFailure[];
}> {
  const user = await requireUser();
  const supabase = createServerSupabase();
  const admin = createAdminSupabase();
  if (!admin)
    return {
      ok: false,
      error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.',
      errorSource: 'app',
    };

  // Same IDOR guard as createSigningRequestAction: everything below runs
  // on the RLS-bypassing admin client, so prove membership of firmId
  // first and then prove the signature belongs to that same firm.
  const { data: mem } = await supabase
    .from('firm_members')
    .select('role, display_name')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (mem as { role?: string } | null)?.role;
  if (!role || !['owner', 'admin', 'attorney', 'paralegal'].includes(role)) {
    return {
      ok: false,
      error: 'You do not have permission to send this document for signature.',
      errorSource: 'app',
    };
  }

  const { data: sigRow } = await admin
    .from('firm_signatures')
    .select('id, signing_request_id, signer_email, signer_name, token, signed_at, access_code_hash')
    .eq('id', signatureId)
    .maybeSingle();
  const sig = sigRow as {
    id: string;
    signing_request_id: string;
    signer_email: string;
    token: string;
    signed_at: string | null;
    access_code_hash: string | null;
  } | null;
  // Nothing about this signature may be disclosed before the caller has
  // proven the firm owns it, so a signature id that does not exist and
  // one that belongs to ANOTHER firm answer with the same sentence. A
  // distinct "Signer not found." here would turn this endpoint into a
  // cross-tenant probe: enumerate ids, and the wording alone tells you
  // whether the row exists elsewhere. The already-signed check moves
  // below the ownership check for the same reason.
  const NOT_YOURS = {
    ok: false as const,
    error: 'Signing request not found for this firm.',
    errorSource: 'app' as const,
  };
  if (!sig) return NOT_YOURS;

  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('id, firm_id, document_id, message, status')
    .eq('id', sig.signing_request_id)
    .maybeSingle();
  const req = reqRow as {
    firm_id: string;
    document_id: string;
    message: string | null;
    status: FirmSigningStatus;
  } | null;
  if (!req || req.firm_id !== firmId) return NOT_YOURS;

  if (sig.signed_at)
    return { ok: false, error: 'This signer has already signed.', errorSource: 'app' };

  // The server has to enforce what the page implies. The detail page
  // hides Resend for a request that was rejected or sent back for
  // changes, but every 'use server' export is a public endpoint, so a
  // direct call would otherwise re-mail the sign link for a request the
  // signer has already declined. Reopen it first, then resend.
  if (
    req.status === 'canceled' ||
    req.status === 'completed' ||
    req.status === 'rejected' ||
    req.status === 'changes_requested'
  ) {
    return {
      ok: false,
      error: 'This request is no longer open. Reopen it or send a new one.',
      errorSource: 'app',
    };
  }

  // Throttle, on the same helper the access-code check uses. Without it
  // any paralegal-or-above could name an address on a request and then
  // hold down Resend, putting one or two messages per click into that
  // inbox from the firm's verified sending domain. Keyed per signature
  // and placed AFTER the ownership check, so one firm cannot burn
  // another's bucket. Fails closed: this is an outbound-mail abuse
  // surface, and the copy tells the caller to wait rather than leaving
  // them wondering.
  const withinLimit = await checkRateLimit(`signing-resend:${sig.id}`, {
    limit: 3,
    windowSeconds: 600,
    failClosed: true,
  });
  if (!withinLimit) {
    return {
      ok: false,
      error: 'This signer was emailed a moment ago. Try again in a few minutes.',
      errorSource: 'app',
    };
  }

  // ...and the budget for the address itself, which the bucket above
  // cannot speak for: a fresh request naming the same victim mints a new
  // signature id and therefore a brand-new per-signature bucket. The two
  // answer different questions, so both are asked.
  if (!(await withinRecipientMailBudget(sig.signer_email.trim().toLowerCase()))) {
    return {
      ok: false,
      error: 'This address has had several signing emails recently. Try again in a few minutes.',
      errorSource: 'app',
    };
  }

  const { data: docRow } = await admin
    .from('firm_documents')
    .select('name')
    .eq('id', req.document_id)
    .maybeSingle();
  const docName = (docRow as { name?: string } | null)?.name ?? 'Document';

  const { data: firmRow } = await admin
    .from('firms')
    .select('name, logo_url')
    .eq('id', firmId)
    .maybeSingle();
  const firmName =
    ((firmRow as { name?: string } | null)?.name ?? 'Advottic').trim() || 'Advottic';
  const firmLogo =
    (firmRow as { logo_url?: string | null } | null)?.logo_url ?? null;
  const senderName =
    ((mem as { display_name?: string | null } | null)?.display_name || '').trim() ||
    (user.email ? user.email.split('@')[0] : '') ||
    'A team member';
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

  // access_code_hash non-null is what marks this signer as external.
  const isExternal = sig.access_code_hash !== null;
  const emailFailures: SigningEmailFailure[] = [];

  const linkResult = await sendSigningLinkEmail({
    to: sig.signer_email,
    firmName,
    firmLogo,
    senderName,
    docName,
    message: req.message,
    url: `${baseUrl}/sign/${sig.token}`,
    isExternal,
  });
  if (!linkResult.ok) {
    emailFailures.push({
      email: sig.signer_email,
      kind: 'link',
      error: linkResult.error,
      source: 'provider',
    });
  }
  // Which of this signer's emails the provider actually took. Drives the
  // reminder_sent event below, so the audit trail records a delivery
  // rather than an intention.
  const delivered: Array<'link' | 'code'> = linkResult.ok ? ['link'] : [];

  if (isExternal) {
    const { sha256 } = await import('./esign-audit');
    const accessCode = newAccessCode();
    const codeResult = await sendSigningCodeEmail({
      to: sig.signer_email,
      firmName,
      firmLogo,
      docName,
      code: accessCode,
    });
    if (codeResult.ok) {
      // Only rotate the stored hash once the new code is on its way. If
      // the send failed, the signer keeps whatever code they may already
      // have rather than being locked out by a code nobody received -
      // and, just as important, the attempt counter below is NOT cleared
      // for a code nobody received.
      //
      // access_attempts is the whole point of the reset. Eight wrong
      // guesses lock the code and verifyAccessCodeAction tells the
      // signer, in as many words, to ask the firm to resend. Nothing
      // else in the tree ever clears that counter, so without this the
      // instruction was guaranteed to fail: the fresh code arrives, the
      // signer types it, and the lockout returns before the hash is ever
      // compared. Resend is the recovery path, so it has to actually
      // recover.
      //
      // access_code_verified_at goes with it. It is the "this token is
      // already unlocked" latch, checked before the lockout and before
      // the hash. Leaving it set would mean rotating the credential had
      // no effect on an already-unlocked link. The new code is the sole
      // gate, and the signer holds it.
      //
      // Conditional on the hash read at the top of this action. Two
      // resends fired at once both pass the window and both mint a code;
      // unconditional, the later UPDATE simply wins the row and the
      // signer is left holding one live code and one dead one with no
      // way to tell them apart, the newest not necessarily being the
      // live one. This is a public endpoint, so "the button blocks while
      // pending" is not a control. Matching the previous hash makes the
      // loser of the race visible instead: zero rows affected means
      // somebody else rotated first. One round trip, no serialization.
      const { data: rotated, error: rotateErr } = await admin
        .from('firm_signatures')
        .update({
          access_code_hash: sha256(accessCode),
          access_attempts: 0,
          access_code_verified_at: null,
        })
        .eq('id', sig.id)
        .eq('access_code_hash', sig.access_code_hash)
        .select('id');
      const rotatedRows = (rotated as Array<{ id: string }> | null) ?? [];
      if (rotateErr || rotatedRows.length === 0) {
        // The code email has already gone out, so the caller has to hear
        // that the code in it is not the one the gate will accept. And
        // nothing is appended to the chain: it must not assert a
        // rotation that did not land.
        emailFailures.push({
          email: sig.signer_email,
          kind: 'code',
          error: rotateErr
            ? 'The new access code could not be saved, so the old one still applies. Try again.'
            : 'Another resend for this signer landed first. Resend once more so only the newest code works.',
          source: 'app',
        });
      } else {
        delivered.push('code');
        const { appendSignatureEvent } = await import('./esign-audit');
        await appendSignatureEvent(admin, {
          signingRequestId: sig.signing_request_id,
          signatureId: sig.id,
          eventType: 'access_code_sent',
          userId: user.id,
          signerEmail: sig.signer_email,
        }).catch(() => {});
      }
    } else {
      emailFailures.push({
        email: sig.signer_email,
        kind: 'code',
        error: codeResult.error,
        source: 'provider',
      });
    }
  }

  // "The firm re-sent this request on date X" is the one fact a firm
  // needs when a signer says nothing ever arrived, and reminder_sent has
  // been a declared event type with no emitter. One event per resend,
  // internal or external, and only for mail the provider accepted - the
  // chain is evidence, so it must not assert a delivery that failed.
  if (delivered.length > 0) {
    const { appendSignatureEvent } = await import('./esign-audit');
    await appendSignatureEvent(admin, {
      signingRequestId: sig.signing_request_id,
      signatureId: sig.id,
      eventType: 'reminder_sent',
      userId: user.id,
      signerEmail: sig.signer_email,
      metadata: { channel: 'email', delivered },
    }).catch(() => {});
  }

  // A resend that reached the signer is the moment the request stopped
  // being a draft, so promote it on exactly the fact the create path
  // uses. Without this the recovery path leaves the request reading
  // "Draft, not yet sent" until somebody signs it, and every surface
  // that filters on status answers that the firm has nothing out for
  // signature while the signer is looking at the document.
  //
  // Whether the request is still a draft is markSigningRequestSent's
  // own decision, taken in the UPDATE rather than from the status read
  // at the top of this action. Asking here as well would cost one
  // no-op write on the common case and buy nothing: two guards on one
  // fact, either of which can rot without a test noticing, because
  // each hides the other.
  if (delivered.includes('link')) {
    await markSigningRequestSent(admin, {
      requestId: sig.signing_request_id,
      documentId: req.document_id,
      userId: user.id,
      metadata: { sent_by: 'resend', signer_email: sig.signer_email },
    });
  }

  revalidatePath(`/counsel/signing/${sig.signing_request_id}`);
  return {
    ok: emailFailures.length === 0,
    ...(emailFailures.length > 0
      ? {
          emailFailures,
          error: emailFailures[0].error,
          errorSource: emailFailures[0].source,
        }
      : {}),
  };
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

/**
 * WHY ALL FOUR OF THESE ARE OWNER/ADMIN GATED.
 *
 * A row in firm_webhook_configs is an outbound egress channel for an
 * organization's matter-room chat. fanoutWebhooks above reads the table
 * through the SERVICE-ROLE client on every message send and POSTs a preview of
 * the message body to whatever `url` the row carries, so planting one row is
 * enough to redirect a firm's privileged conversation to an arbitrary
 * endpoint. Reading the table is the mirror of that: a Slack or Teams incoming
 * webhook URL is itself a bearer credential, so `url` is a secret and listing
 * it is disclosure, not metadata.
 *
 * These four exports had `requireUser()` and nothing else. Every export of a
 * `'use server'` module is a public HTTP endpoint callable with arguments of
 * the caller's choosing, so "the settings page already redirects anyone who is
 * not an owner or an admin" was never the gate; it was a courtesy to a
 * browser. The gate has to be here.
 *
 * The role set is callerIsFirmAdmin, from lib/firm-authz, because that is the
 * set app/counsel/settings/page.tsx has always redirected to. Nothing that the
 * product offers a person is being taken away: attorney, paralegal and staff
 * could not reach this surface in the UI before and cannot now.
 *
 * firm_webhook_configs has no CREATE TABLE, no policy and no grant anywhere in
 * this repository, so nothing here may lean on RLS as a second line. See
 * supabase/fixes/2026-08-12-firm-webhook-configs-rls.sql, which is written but
 * NOT applied.
 */

/**
 * One sentence for "no such webhook" and for "that webhook belongs to another
 * firm". Answering those differently turns the id argument into an existence
 * oracle that a stranger can walk. The caller is an owner or an admin of the
 * webhook's own organization, or they learn nothing at all.
 */
const WEBHOOK_NOT_AVAILABLE = 'That webhook is not available to you.';

/**
 * Resolve which organization a webhook id belongs to and confirm the caller
 * administers it.
 *
 * The lookup runs through the USER-scoped client on purpose. These four
 * actions touch no service-role client, so if a policy is ever added to this
 * table the read fails closed rather than reaching past it.
 */
async function authorizeWebhook(
  webhookId: string,
): Promise<{ ok: true; firmId: string } | { ok: false; error: string }> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_webhook_configs')
    .select('firm_id')
    .eq('id', webhookId)
    .maybeSingle();
  const firmId = (data as { firm_id?: string } | null)?.firm_id ?? null;
  if (!firmId) return { ok: false, error: WEBHOOK_NOT_AVAILABLE };
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: WEBHOOK_NOT_AVAILABLE };
  }
  return { ok: true, firmId };
}

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
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
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
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }
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
  const gate = await authorizeWebhook(webhookId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = createServerSupabase();
  // `.select('id')` is what separates "wrote" from "matched nothing".
  // PostgREST reports no error on a zero-row update, so without it a caller
  // whose write was silently dropped is told the toggle moved.
  const { data, error } = await supabase
    .from('firm_webhook_configs')
    .update({ is_active: active })
    .eq('id', webhookId)
    .eq('firm_id', gate.firmId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) return { ok: false, error: WEBHOOK_NOT_AVAILABLE };
  revalidatePath('/counsel/settings');
  return { ok: true };
}

export async function deleteFirmWebhookAction(
  webhookId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const gate = await authorizeWebhook(webhookId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_webhook_configs')
    .delete()
    .eq('id', webhookId)
    .eq('firm_id', gate.firmId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) return { ok: false, error: WEBHOOK_NOT_AVAILABLE };
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
      <p>Single-use link. Expires ${escapeHtml(formatDateNumeric(g.expires_at))}.</p>
      <p>- The Advottic team</p>
    `,
    text: `Reminder: the Advottic Counsel workspace for ${g.organization_name} is still waiting for you.\n\nActivation link:\n${url}\n\nExpires ${formatDateNumeric(g.expires_at)}.\n\n- The Advottic team`,
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
  // Membership is not the question: `staff` is a firm member and is sold
  // read-only access to non-privileged surfaces. Opening a matter is neither
  // read-only nor non-privileged, and the insert below runs on the service
  // role, so this check is the only thing standing in front of it.
  if (!(await callerHasFirmRole(firmId, FIRM_POSTING_ROLES))) {
    return { ok: false, error: FIRM_MATTER_ROLE_REFUSAL };
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
  // Answered before the matter is looked up, so a role that cannot reach
  // matters cannot use this endpoint to find out which ids are real.
  if (!(await callerHasFirmRole(firmId, FIRM_POSTING_ROLES))) {
    return { ok: false, error: FIRM_MATTER_ROLE_REFUSAL };
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
  // One sentence for "no such matter", "not a firm matter" and "not yours".
  // The id is the caller's argument, so answering those apart would let a
  // stranger walk ids and learn which ones exist.
  if (!firmId) return { ok: false, error: 'You do not have access to this matter.' };
  // Reassigning a matter is running it, which is what `staff` is sold as NOT
  // being able to do. The update below is a service-role write.
  if (!(await callerHasFirmRole(firmId, FIRM_POSTING_ROLES))) {
    return { ok: false, error: FIRM_MATTER_ROLE_REFUSAL };
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

/** The statuses a matter can be moved to, as values rather than as a type. */
const CASE_STATUSES = Object.keys(STATUS_LABEL) as CaseStatus[];

/**
 * Move a matter to a new status, from the counsel side.
 *
 * There was no firm status control before this, and the reason there was none
 * is the defect this function exists not to repeat. The consumer mutation
 * (setCaseStatusAction) writes through the USER-scoped client, and
 * `cases_update_own` is `auth.uid() = user_id`, so a firm attorney who is not
 * the case row's owner updated zero rows, got no error back, and had
 * `case_status_changed` written into the audit chain for a transition that
 * never happened. An inline status control on a firm surface would have been
 * that path with a button attached to it.
 *
 * So this is a separate mutation with the firm's own three properties:
 *
 *   - authorized through lib/firm-authz, the only firm authorization axis.
 *     Every export of this module is a public HTTP endpoint, and the write
 *     below bypasses RLS entirely, so this check is the only gate there is.
 *     FIRM_POSTING_ROLES is the set the `cases` update policy names, and it
 *     excludes `staff`, who are sold read-only access.
 *   - written through the service-role client, because is_case_member RLS is
 *     not firm-aware and every other firm write to `cases` already goes this
 *     way.
 *   - confirmed. `.select('id')` is what separates "wrote" from "matched
 *     nothing", and the audit entry is a consequence of that confirmation
 *     rather than of the call returning. Nothing is logged and nothing is
 *     reported as ok until a row comes back.
 *
 * `.eq('firm_id', firmId)` alongside the id is belt and braces: firmId is
 * read from the matter itself just above, so the two cannot disagree, but it
 * keeps the write scoped to the firm the caller was actually authorized for.
 */
export async function setFirmCaseStatusAction(
  caseId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  if (!CASE_STATUSES.includes(status as CaseStatus)) {
    // Returned, not thrown. A thrown server action rejects the transition and
    // replaces the surrounding surface with an error boundary instead of
    // telling the control what happened, which is what took the matter page
    // down once already. See app/counsel/cases/set-status.ts.
    return { ok: false, error: 'That is not a status a matter can be in.' };
  }

  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id, status')
    .eq('id', caseId)
    .maybeSingle();
  const cr = caseRow as { firm_id: string | null; status: CaseStatus } | null;
  const firmId = cr?.firm_id ?? null;
  if (!firmId) return { ok: false, error: 'Matter not found.' };
  if (!(await callerHasFirmRole(firmId, FIRM_POSTING_ROLES))) {
    return {
      ok: false,
      error: 'Only firm owners, admins, attorneys or paralegals can change a matter status.',
    };
  }
  await requireActiveFirm(firmId);

  const from = cr?.status ?? null;
  if (from === status) return { ok: true };

  const { data: written, error } = await admin
    .from('cases')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!written || written.length === 0) {
    return {
      ok: false,
      error: 'That change could not be saved. Nothing on the matter has moved.',
    };
  }

  // Only now. The row is written, so the chain is describing an event.
  try {
    const { logCaseEvent } = await import('./activity');
    await logCaseEvent({
      caseId,
      eventType: 'case_status_changed',
      metadata: { from, to: status, via: 'firm' },
    });
  } catch {
    /* a missing entry is a gap in the record; a false one is a wrong record */
  }

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
 * Returns an empty list to anyone this firm's matter material is not open to.
 *
 * FIRM_POSTING_ROLES, not membership. What comes back is not a list of names:
 * lib/storage.ts listCollaboratorsAsFirm selects `*` from case_collaborators
 * through the SERVICE-ROLE client, and collaboratorFromRow carries
 * `witness_statement` onto every Collaborator it builds. That column is a
 * witness's own account of what happened, written into a matter, and it is
 * privileged work product by any reading. `staff` is described to a firm owner
 * in writing, at the moment they send the invitation, as "read-only access to
 * non-privileged surfaces", and supabase/migrations/20260731_staff_role_read_scope.sql
 * is applied and already refuses that role the matter row itself; this endpoint
 * went around it, because the service role does not consult RLS and every
 * export of this module is a public HTTP endpoint that any signed-in user can
 * call with a matter id of their choosing.
 *
 * The matter has to be read before the role is checked, because the argument
 * carries no firm id and the row is the only thing that says which
 * organization to ask about. That read is a `cases` lookup and nothing else;
 * the collaborator rows are never fetched for a caller who fails the gate.
 *
 * Viewing stays open to the whole legal team. Inviting and removing are gated
 * more narrowly still, by callerCanManageMatter on their own actions.
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
  if (!(await callerHasFirmRole(firmId, FIRM_POSTING_ROLES))) return [];
  return listCollaboratorsAsFirm(caseId, firmId);
}

// Marker so we can inspect at runtime whether the redirect helper is
// being treated as a side effect. Used by smoke tests.
export async function _firmActionsLoaded(): Promise<true> {
  return true;
}
