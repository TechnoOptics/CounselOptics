'use server';

import { revalidatePath } from 'next/cache';
import crypto from 'node:crypto';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getCurrentSubscription, getProfile, getSubscriptionForUser } from './storage';
import { listMyFirms } from './firm-storage';
import { tierSlugFromPriceId } from './stripe';
import type { Subscription } from './types';
import { appendWitnessEvent } from './witness-audit';
import { validateCommunityUpload } from './upload-safety';
import {
  generateCaseNumber,
  generateSlug,
  type CommunityCase,
  type CommunityCaseImage,
  type CommunityCaseLink,
  type CommunityCaseLinkPlatform,
  type MailingAddress,
  type WitnessSubmission,
} from './community-types';

export type CommunityActionResult = { ok: boolean; error?: string; slug?: string };

/** Personal Plus (personal track) or Growing Firm/Enterprise (firm
 * track). Deliberately excludes Personal Pro, Solo, and Small Firm -
 * tierSlugFromPriceId (lib/stripe.ts) already distinguishes these
 * correctly; the legacy `tier` field on Subscription does NOT (it
 * collapses every paid tier, including Personal Pro and Solo, down to
 * 'pro') so it must not be used for this check except as the narrow
 * comp-account signal below. */
// Group (Community) cases are an Ultra personal feature, or Growing Firm+ on
// the firm track. Lifetime-comp accounts resolve to the 'ultra' slug, so they
// pass here too. Legacy 'pro_plus' kept for any grandfathered Personal Plus.
const ELIGIBLE_TIER_SLUGS = new Set(['ultra', 'pro_plus', 'growing_firm', 'enterprise']);

/** True if a subscription is active/trialing at Personal Plus or above
 * (or Growing Firm or above for firm tiers). Shared by the caller's-own-
 * subscription check and the firm-membership fallback below, so the two
 * paths can never silently drift apart on what "eligible" means. */
function subscriptionMeetsEligibleTier(subscription: Subscription | null): boolean {
  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  if (!isActive) return false;
  // Comp accounts (founder/support/QA) carry priceId: null, tier: 'pro' -
  // treat that specific combination as eligible without consulting
  // tierSlugFromPriceId (which only resolves real Stripe price IDs).
  const isCompProGrant = subscription?.priceId == null && subscription?.tier === 'pro';
  if (isCompProGrant) return true;
  const slug = tierSlugFromPriceId(subscription?.priceId ?? null);
  return slug !== null && ELIGIBLE_TIER_SLUGS.has(slug);
}

/**
 * Organizer eligibility: signed in, verified email, a verified phone
 * number, and an active/trialing subscription at Personal Plus or above
 * - either the CALLER'S OWN subscription, or (multi-seat firms) any
 * firm they belong to whose CREATOR holds a Growing Firm+ subscription.
 * Firms have no firm-level tier field of their own in the data model -
 * a firm's plan is really its creator's personal subscription - so a
 * firm member other than the creator/owner is checked by looking up
 * that subscription on their behalf via the service-role client
 * (getSubscriptionForUser), never by trusting anything the client sent.
 * Never trust a client-side check alone - this re-verifies server-side
 * regardless of what the UI already showed.
 */
async function assertOrganizerEligible() {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must sign in to create a Community Case page.');
  if (!user.email_confirmed_at) {
    throw new Error('Please verify your email address before creating a Community Case page.');
  }

  const [subscription, profile] = await Promise.all([getCurrentSubscription(), getProfile()]);
  let hasEligibleTier = subscriptionMeetsEligibleTier(subscription);

  if (!hasEligibleTier) {
    // Fall back to checking each firm this user belongs to. A firm's
    // "plan" is its creator's own subscription (no firm-level billing
    // entity exists), so a Growing Firm+ subscription held by the firm
    // creator qualifies every member of that firm, not just the
    // creator themselves.
    const memberships = await listMyFirms();
    const creatorIds = Array.from(
      new Set(
        memberships
          .map((m) => m.firm.createdBy)
          .filter((id): id is string => Boolean(id) && id !== user.id),
      ),
    );
    const creatorSubscriptions = await Promise.all(
      creatorIds.map((id) => getSubscriptionForUser(id).catch(() => null)),
    );
    hasEligibleTier = creatorSubscriptions.some((sub) => subscriptionMeetsEligibleTier(sub));
  }

  if (!hasEligibleTier) {
    throw new Error(
      'Creating a Community Case page requires the Ultra plan (Growing Firm or above for firm accounts).',
    );
  }

  if (!profile?.phoneVerifiedAt) {
    throw new Error('Please verify your phone number on your profile page before creating a Community Case page.');
  }

  return user;
}

/**
 * Soft duplicate/impersonation signal - see the migration comment in
 * supabase/fixes/2026-07-02-community-duplicate-detection.sql. Never
 * throws or blocks creation; a lookup failure (e.g. RPC not yet applied
 * in a given environment) just means no warning gets attached.
 */
async function findDuplicateWarning(
  supabase: ReturnType<typeof createServerSupabase>,
  displayName: string,
): Promise<string | null> {
  try {
    const { data } = await supabase.rpc('find_similar_community_case', {
      _display_name: displayName,
    });
    const match = (data as Array<{ case_number: string; display_name: string; score: number }> | null)?.[0];
    if (!match) return null;
    return `This name is similar to an existing case (${match.case_number}: "${match.display_name}"). If that's not the same matter, no action needed.`;
  } catch {
    return null;
  }
}

function rowToCommunityCase(row: Record<string, unknown>): CommunityCase {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    organizerUserId: row.organizer_user_id as string,
    caseNumber: row.case_number as string,
    slug: row.slug as string,
    displayName: row.display_name as string,
    publicSummary: (row.public_summary as string) ?? null,
    bondAmountCents: (row.bond_amount_cents as number) ?? null,
    hearingDisplayOverride: (row.hearing_display_override as string) ?? null,
    bannerImagePath: (row.banner_image_path as string) ?? null,
    status: row.status as CommunityCase['status'],
    searchIndexable: Boolean(row.search_indexable),
    letterCount: (row.letter_count as number) ?? 0,
    evidenceCount: (row.evidence_count as number) ?? 0,
    duplicateWarning: (row.duplicate_warning as string) ?? null,
    publishedAt: (row.published_at as string) ?? null,
    closedAt: (row.closed_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getCommunityCaseForCase(caseId: string): Promise<CommunityCase | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('community_cases')
    .select('*')
    .eq('case_id', caseId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToCommunityCase(data as Record<string, unknown>);
}

export async function listCommunityCaseLinks(
  communityCaseId: string,
): Promise<CommunityCaseLink[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('community_case_links')
    .select('*')
    .eq('community_case_id', communityCaseId)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    communityCaseId: row.community_case_id as string,
    platform: row.platform as CommunityCaseLinkPlatform,
    label: (row.label as string) ?? null,
    url: (row.url as string) ?? null,
    handle: (row.handle as string) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
  }));
}

/**
 * Create the Community Case page for an existing case. The organizer must
 * already own the case (RLS enforces `case_id` ownership on insert via
 * community_cases_insert_owner). Starts in `draft` - the organizer reviews
 * and publishes separately (publishCommunityCaseAction) so nothing goes
 * public accidentally on creation.
 */
export async function createCommunityCaseAction(
  caseId: string,
  formData: FormData,
): Promise<CommunityActionResult> {
  try {
    const user = await assertOrganizerEligible();
    const displayName = String(formData.get('displayName') ?? '').trim();
    const publicSummary = String(formData.get('publicSummary') ?? '').trim();
    const bondAmountRaw = String(formData.get('bondAmount') ?? '').trim();
    const hearingDisplayOverride = String(formData.get('hearingDisplayOverride') ?? '').trim();

    if (!displayName) {
      return { ok: false, error: 'Please give the case a public name.' };
    }
    const bondAmountCents = bondAmountRaw
      ? Math.round(parseFloat(bondAmountRaw) * 100)
      : null;
    if (bondAmountRaw && (bondAmountCents === null || Number.isNaN(bondAmountCents))) {
      return { ok: false, error: 'Bond amount must be a number.' };
    }

    const supabase = createServerSupabase();

    // Soft duplicate/impersonation signal: a close trigram match against
    // an existing published/closed case's display name. Never blocks
    // creation - a note for the organizer/attorney of the NEW page to
    // read, since a false positive (two unrelated "Maria Torres" cases)
    // is more likely than not for common names, and the whole point is a
    // human decides, not an automatic rejection.
    const duplicateWarning = await findDuplicateWarning(supabase, displayName);

    // Generate a case number + slug, retrying on the astronomically rare
    // unique-constraint collision rather than pre-checking existence
    // (avoids a check-then-insert race).
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const caseNumber = generateCaseNumber();
      const slug = generateSlug(displayName, caseNumber);
      const { data, error } = await supabase
        .from('community_cases')
        .insert({
          case_id: caseId,
          organizer_user_id: user.id,
          case_number: caseNumber,
          slug,
          display_name: displayName,
          public_summary: publicSummary || null,
          bond_amount_cents: bondAmountCents,
          hearing_display_override: hearingDisplayOverride || null,
          status: 'draft',
          duplicate_warning: duplicateWarning,
        })
        .select('slug')
        .single();
      if (!error) {
        revalidatePath(`/cases/${caseId}`);
        revalidatePath(`/cases/${caseId}/community`);
        return { ok: true, slug: (data as { slug: string }).slug };
      }
      if (error.code === '23505') {
        // Unique violation on case_number/slug - regenerate and retry.
        lastError = error.message;
        continue;
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: lastError ?? 'Could not generate a unique case number.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create page.' };
  }
}

export async function updateCommunityCaseAction(
  communityCaseId: string,
  caseId: string,
  formData: FormData,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const displayName = String(formData.get('displayName') ?? '').trim();
    const publicSummary = String(formData.get('publicSummary') ?? '').trim();
    const bondAmountRaw = String(formData.get('bondAmount') ?? '').trim();
    const hearingDisplayOverride = String(formData.get('hearingDisplayOverride') ?? '').trim();
    if (!displayName) return { ok: false, error: 'Please give the case a public name.' };
    const bondAmountCents = bondAmountRaw
      ? Math.round(parseFloat(bondAmountRaw) * 100)
      : null;

    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('community_cases')
      .update({
        display_name: displayName,
        public_summary: publicSummary || null,
        bond_amount_cents: bondAmountCents,
        hearing_display_override: hearingDisplayOverride || null,
      })
      .eq('id', communityCaseId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save changes.' };
  }
}

/** Uploads the organizer's banner image to the public community-public
 * bucket. Goes through the admin client because that bucket has no
 * authenticated storage policy (writes are organizer-server-action-only
 * by design, matching the community-submissions bucket's posture). */
// Public banner/gallery images accept only real images (validateCommunityUpload
// also allows PDF, which must not be served as a public "photo").
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function uploadCommunityBannerAction(
  communityCaseId: string,
  caseId: string,
  formData: FormData,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: 'Please choose an image.' };
    }
    const MAX_BANNER_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BANNER_BYTES) {
      return { ok: false, error: 'Image is larger than the 10MB limit.' };
    }
    const admin = createAdminSupabase();
    if (!admin) return { ok: false, error: 'Storage is not configured on the server.' };

    // Magic-byte validation before writing to the PUBLIC bucket. Without
    // it, the filename extension + declared MIME were trusted, so an
    // organizer could serve a non-image (e.g. an HTML/SVG payload named
    // .jpg) from a public URL. Derive both the path extension and the
    // stored content-type from the VALIDATED type, never the upload's.
    const buffer = Buffer.from(await file.arrayBuffer());
    const check = validateCommunityUpload(buffer);
    if (!check.ok) return { ok: false, error: check.reason };
    const imgExt = IMAGE_EXT_BY_MIME[check.mimeType];
    if (!imgExt) {
      return { ok: false, error: 'Please upload a JPEG, PNG, or WebP image.' };
    }
    const path = `${communityCaseId}/banner.${imgExt}`;
    const { error: uploadErr } = await admin.storage
      .from('community-public')
      .upload(path, buffer, { contentType: check.mimeType, upsert: true });
    if (uploadErr) return { ok: false, error: uploadErr.message };

    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('community_cases')
      .update({ banner_image_path: path })
      .eq('id', communityCaseId);
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not upload image.' };
  }
}

const MAX_GALLERY_IMAGES = 12;

/** Additional photos beyond the single banner - same public
 * `community-public` bucket and upload-safety posture as
 * uploadCommunityBannerAction (these are images the organizer chose to
 * publish, not private witness material). */
export async function addCommunityGalleryImageAction(
  communityCaseId: string,
  caseId: string,
  formData: FormData,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: 'Please choose an image.' };
    }
    const MAX_GALLERY_IMAGE_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_GALLERY_IMAGE_BYTES) {
      return { ok: false, error: 'Image is larger than the 10MB limit.' };
    }
    const supabase = createServerSupabase();
    const { count } = await supabase
      .from('community_case_images')
      .select('id', { count: 'exact', head: true })
      .eq('community_case_id', communityCaseId);
    if ((count ?? 0) >= MAX_GALLERY_IMAGES) {
      return { ok: false, error: `You can add up to ${MAX_GALLERY_IMAGES} photos.` };
    }

    const admin = createAdminSupabase();
    if (!admin) return { ok: false, error: 'Storage is not configured on the server.' };

    // Same magic-byte validation as the banner upload - public bucket,
    // so the stored type/extension come from the validated bytes.
    const buffer = Buffer.from(await file.arrayBuffer());
    const check = validateCommunityUpload(buffer);
    if (!check.ok) return { ok: false, error: check.reason };
    const imgExt = IMAGE_EXT_BY_MIME[check.mimeType];
    if (!imgExt) {
      return { ok: false, error: 'Please upload a JPEG, PNG, or WebP image.' };
    }
    const imageId = crypto.randomUUID();
    const path = `${communityCaseId}/gallery/${imageId}.${imgExt}`;
    const { error: uploadErr } = await admin.storage
      .from('community-public')
      .upload(path, buffer, { contentType: check.mimeType, upsert: false });
    if (uploadErr) return { ok: false, error: uploadErr.message };

    const caption = String(formData.get('caption') ?? '').trim();
    const { error } = await supabase.from('community_case_images').insert({
      id: imageId,
      community_case_id: communityCaseId,
      storage_path: path,
      caption: caption || null,
      sort_order: count ?? 0,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not upload image.' };
  }
}

export async function removeCommunityGalleryImageAction(
  imageId: string,
  caseId: string,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const supabase = createServerSupabase();
    const { data: row } = await supabase
      .from('community_case_images')
      .select('storage_path')
      .eq('id', imageId)
      .maybeSingle();
    const path = (row as { storage_path: string } | null)?.storage_path;

    const { error } = await supabase.from('community_case_images').delete().eq('id', imageId);
    if (error) return { ok: false, error: error.message };

    if (path) {
      const admin = createAdminSupabase();
      if (admin) await admin.storage.from('community-public').remove([path]);
    }

    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove image.' };
  }
}

export async function listCommunityGalleryImages(
  communityCaseId: string,
): Promise<CommunityCaseImage[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('community_case_images')
    .select('*')
    .eq('community_case_id', communityCaseId)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    communityCaseId: row.community_case_id as string,
    storagePath: row.storage_path as string,
    caption: (row.caption as string) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
  }));
}

export async function addCommunityLinkAction(
  communityCaseId: string,
  caseId: string,
  formData: FormData,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const platform = String(formData.get('platform') ?? '').trim() as CommunityCaseLinkPlatform;
    const label = String(formData.get('label') ?? '').trim();
    const url = String(formData.get('url') ?? '').trim();
    const handle = String(formData.get('handle') ?? '').trim();
    const validPlatforms: CommunityCaseLinkPlatform[] = [
      'gofundme',
      'cashapp',
      'zelle',
      'venmo',
      'paypal',
      'other',
    ];
    if (!validPlatforms.includes(platform)) {
      return { ok: false, error: 'Please choose a platform.' };
    }
    if (!url && !handle) {
      return { ok: false, error: 'Please provide a link or a handle.' };
    }
    // Basic well-formedness + domain sanity check on URLs - cheap guard
    // against an obviously malformed or lookalike-domain link before it
    // gets published for anonymous visitors to click.
    if (url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, error: 'That link does not look like a valid URL.' };
      }
      // http(s) only, for every platform including 'other' - this link is
      // rendered as a real <a href> on the public page
      // (app/community/[slug]/page.tsx), and `new URL()` happily parses
      // schemes like javascript: or data: (hostname comes back empty,
      // which only the platform-specific domain checks below would have
      // caught - 'other' has no domain check at all, so without this it
      // would be a stored-XSS path for any organizer account).
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'Links must start with http:// or https://.' };
      }
      const expectedHost: Partial<Record<CommunityCaseLinkPlatform, RegExp>> = {
        gofundme: /(^|\.)gofundme\.com$/i,
        cashapp: /(^|\.)cash\.app$/i,
        venmo: /(^|\.)venmo\.com$/i,
        paypal: /(^|\.)paypal\.(com|me)$/i,
      };
      const hostCheck = expectedHost[platform];
      if (hostCheck && !hostCheck.test(parsed.hostname)) {
        return {
          ok: false,
          error: `That link does not look like a ${platform} link. Double-check the URL.`,
        };
      }
    }

    const supabase = createServerSupabase();
    const { count } = await supabase
      .from('community_case_links')
      .select('id', { count: 'exact', head: true })
      .eq('community_case_id', communityCaseId);
    const { error } = await supabase.from('community_case_links').insert({
      community_case_id: communityCaseId,
      platform,
      label: label || null,
      url: url || null,
      handle: handle || null,
      sort_order: count ?? 0,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add link.' };
  }
}

export async function removeCommunityLinkAction(
  linkId: string,
  caseId: string,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const supabase = createServerSupabase();
    const { error } = await supabase.from('community_case_links').delete().eq('id', linkId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove link.' };
  }
}

export async function publishCommunityCaseAction(
  communityCaseId: string,
  caseId: string,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('community_cases')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', communityCaseId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not publish page.' };
  }
}

export async function unpublishCommunityCaseAction(
  communityCaseId: string,
  caseId: string,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('community_cases')
      .update({ status: 'draft' })
      .eq('id', communityCaseId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not unpublish page.' };
  }
}

/**
 * Closing takes the public page down immediately (status flips to
 * 'closed', so get_public_community_case still returns it read-only per
 * the RPC's `status in ('published','closed')` check, but the submission
 * routes refuse new writes once status !== 'published'). v1 carries no ID
 * photos yet (evidence-only slice), so there is no purge job wired up
 * here - once Letters of Support ship, this is where the 48h
 * pending_purge scheduling gets added rather than deleting synchronously.
 */
/**
 * Closing stops public visibility immediately (get_public_community_case
 * only returns 'published' rows) but does NOT delete ID/signature images
 * synchronously - it schedules them for deletion 48h out via
 * purge_scheduled_at, so an accidental or premature close can still be
 * undone with reopenCommunityCaseAction before the purge cron
 * (lib/community-retention.ts) actually removes anything. This is what
 * enforces the "kept until manually closed" retention decision - see
 * that module's doc comment for the full rationale.
 */
export async function closeCommunityCaseAction(
  communityCaseId: string,
  caseId: string,
  formData: FormData,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const confirm = String(formData.get('confirm') ?? '').trim().toLowerCase();
    if (confirm !== 'close') {
      return { ok: false, error: 'Type "close" to confirm.' };
    }
    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('community_cases')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', communityCaseId);
    if (error) return { ok: false, error: error.message };

    const nowIso = new Date().toISOString();
    const { data: toSchedule } = await supabase
      .from('witness_submissions')
      .select('id')
      .eq('community_case_id', communityCaseId)
      .eq('kind', 'letter_of_support')
      .is('purge_scheduled_at', null)
      .neq('status', 'purged');
    if (toSchedule && toSchedule.length > 0) {
      const ids = toSchedule.map((r) => (r as { id: string }).id);
      await supabase
        .from('witness_submissions')
        .update({ status: 'pending_purge', purge_scheduled_at: nowIso })
        .in('id', ids);
      const admin = createAdminSupabase();
      if (admin) {
        for (const id of ids) {
          await appendWitnessEvent(admin, { submissionId: id, eventType: 'purge_scheduled' });
        }
      }
    }

    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not close page.' };
  }
}

/**
 * Undoes a close within the 48h grace period: reopens the public page
 * and cancels the scheduled purge for any submission the cron hasn't
 * already processed (status='purged' rows are left alone - that
 * deletion already happened and can't be undone). Reverts pending
 * letters to 'reviewed' rather than trying to remember their exact
 * pre-close status, since the organizer closing and reopening a page
 * once already implies they've looked at what's in it.
 */
export async function reopenCommunityCaseAction(
  communityCaseId: string,
  caseId: string,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('community_cases')
      .update({ status: 'published', closed_at: null })
      .eq('id', communityCaseId);
    if (error) return { ok: false, error: error.message };

    await supabase
      .from('witness_submissions')
      .update({ status: 'reviewed', purge_scheduled_at: null })
      .eq('community_case_id', communityCaseId)
      .eq('status', 'pending_purge');

    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reopen page.' };
  }
}

function rowToWitnessSubmission(row: Record<string, unknown>): WitnessSubmission {
  return {
    id: row.id as string,
    communityCaseId: row.community_case_id as string,
    caseId: row.case_id as string,
    kind: row.kind as WitnessSubmission['kind'],
    fullName: (row.full_name as string) ?? null,
    mailingAddress: (row.mailing_address as MailingAddress) ?? null,
    letterBody: (row.letter_body as string) ?? null,
    signatureImagePath: (row.signature_image_path as string) ?? null,
    idFrontPath: (row.id_front_path as string) ?? null,
    idBackPath: (row.id_back_path as string) ?? null,
    evidenceFilePath: (row.evidence_file_path as string) ?? null,
    evidenceFileName: (row.evidence_file_name as string) ?? null,
    evidenceFileType: (row.evidence_file_type as string) ?? null,
    evidenceFileSize: (row.evidence_file_size as number) ?? null,
    testimonialText: (row.testimonial_text as string) ?? null,
    status: row.status as WitnessSubmission['status'],
    purgeScheduledAt: (row.purge_scheduled_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

/** RLS (private.is_case_owner_or_attorney) does the real access control
 * here - this just shapes the rows. Safe to call with any communityCaseId;
 * an unauthorized caller simply gets an empty array back. */
export async function listWitnessSubmissions(
  communityCaseId: string,
): Promise<WitnessSubmission[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('witness_submissions')
    .select('*')
    .eq('community_case_id', communityCaseId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(rowToWitnessSubmission);
}

type WitnessFileField = 'evidence_file_path' | 'id_front_path' | 'id_back_path' | 'signature_image_path';

/**
 * Short-TTL signed URL for one of a submission's private files. Confirms
 * the caller can actually see the submission via the RLS-scoped client
 * first (returns null if not - e.g. a viewer/editor collaborator who is
 * not the owner or an attorney), THEN mints the signed URL with the admin
 * client, since the community-submissions bucket has no authenticated
 * storage policy of its own (reads are exclusively server-signed, never
 * direct client access to storage).
 *
 * Callers are responsible for their own UI-level gating on top of this -
 * e.g. the organizer submissions list requires an explicit click-through
 * warning before calling this for a `pending_review` letter's ID photos,
 * since those haven't been through malware scanning yet (see the
 * community-letters-pending-review migration).
 */
export async function getWitnessFileSignedUrl(
  submissionId: string,
  field: WitnessFileField,
): Promise<string | null> {
  const supabase = createServerSupabase();
  const { data: authorizedRow } = await supabase
    .from('witness_submissions')
    .select(field)
    .eq('id', submissionId)
    .maybeSingle();
  const path = (authorizedRow as Record<string, string | null> | null)?.[field];
  if (!path) return null;

  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from('community-submissions')
    .createSignedUrl(path, 60 * 5);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Organizer/attorney explicitly clears a pending_review Letter of
 * Support after reviewing it - see the pending-review migration comment
 * for the interim-safeguard rationale this supports. */
export async function markSubmissionReviewedAction(
  submissionId: string,
  caseId: string,
): Promise<CommunityActionResult> {
  try {
    await assertOrganizerEligible();
    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('witness_submissions')
      .update({ status: 'reviewed' })
      .eq('id', submissionId)
      .eq('case_id', caseId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update.' };
  }
}
