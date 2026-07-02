'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getCurrentSubscription, getProfile } from './storage';
import { tierSlugFromPriceId } from './stripe';
import {
  generateCaseNumber,
  generateSlug,
  type CommunityCase,
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
const ELIGIBLE_TIER_SLUGS = new Set(['pro_plus', 'growing_firm', 'enterprise']);

/**
 * Organizer eligibility: signed in, verified email, an active/trialing
 * subscription at Personal Plus or above (or Growing Firm or above for
 * firms), and a verified phone number. Checks the CALLER'S OWN
 * subscription - firms have no separate firm-level tier field in the
 * data model today (a multi-seat firm's non-owner employees won't pass
 * this unless they personally hold a qualifying subscription). Never
 * trust a client-side check alone - this re-verifies server-side
 * regardless of what the UI already showed.
 */
async function assertOrganizerEligible() {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must sign in to create a Community Case page.');
  if (!user.email_confirmed_at) {
    throw new Error('Please verify your email address before creating a Community Case page.');
  }

  const [subscription, profile] = await Promise.all([getCurrentSubscription(), getProfile()]);
  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  // Comp accounts (founder/support/QA) carry priceId: null, tier: 'pro' -
  // treat that specific combination as eligible without consulting
  // tierSlugFromPriceId (which only resolves real Stripe price IDs).
  const isCompProGrant = subscription?.priceId == null && subscription?.tier === 'pro';
  const slug = tierSlugFromPriceId(subscription?.priceId ?? null);
  const hasEligibleTier = isActive && (isCompProGrant || (slug !== null && ELIGIBLE_TIER_SLUGS.has(slug)));
  if (!hasEligibleTier) {
    throw new Error(
      'Creating a Community Case page requires a Personal Plus plan or above (Growing Firm or above for firm accounts).',
    );
  }

  if (!profile?.phoneVerifiedAt) {
    throw new Error('Please verify your phone number on your profile page before creating a Community Case page.');
  }

  return user;
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

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${communityCaseId}/banner.${ext || 'jpg'}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await admin.storage
      .from('community-public')
      .upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: true });
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
    revalidatePath(`/cases/${caseId}/community`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not close page.' };
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
