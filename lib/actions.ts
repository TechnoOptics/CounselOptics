'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  addExhibit,
  addExhibitFromStoredObject,
  mintExhibitUploadUrl,
  adminSetUserAdmin,
  adminSetUserBlocked,
  adminUpdateFeedback,
  createCase,
  createFeedback,
  deleteCase,
  getCase,
  getCurrentSubscription,
  getEffectiveTrialState,
  getExhibitById,
  getExhibitFileBuffer,
  inviteCollaborator,
  listExhibits,
  markTourCompleted,
  recordCloseSurvey,
  recordConsent,
  removeCollaborator,
  saveExhibitScan,
  saveReview,
  setExhibitWithdrawn,
  updateCaseHearing,
  updateExhibitDetails,
  updateCaseStatus,
  updateWitnessStatement,
  upsertProfile,
  usingSupabase,
  type CloseSurveyOutcome,
  type FeedbackCategory,
  type FeedbackStatus,
} from './storage';
import {
  classifyCaseType,
  runReview,
  scanDocument,
  scanExtractedText,
  transcribeMedia,
} from './ai';
import {
  classifyExhibitForReading,
  exhibitIsTranscribable,
  exhibitIsVideoRecording,
  extractedTextReadNote,
  unsupportedScanMessage,
} from './exhibit-reading';
import {
  buildManualTranscriptScan,
  checkManualTranscript,
  isManualTranscript,
} from './manual-transcript';
import { extractExhibitText } from './exhibit-text';
import {
  AI_PLACEHOLDER_REFUSED_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
  calmAiMessage,
} from './ai-errors';
import { displayableDigest } from './firm-access';
import { createServerSupabase, getCurrentUser, isCurrentUserAdmin, isSupabaseConfigured } from './supabase/server';
import { logCaseEvent } from './activity';
import { caseLimit, hasFeature, isFullAccessTrial } from './tier';
import { currentUserTrialGrant } from './user-trials';
import type { MenuPortal } from './menu-prefs';
import {
  CASE_TYPES,
  isRealScan,
  type CaseStatus,
  type CaseType,
  type CollaboratorRole,
  type Exhibit,
  type Posture,
  type RepresentationStatus,
  type SubjectProfile,
  type SubjectType,
} from './types';

async function assertAuthIfSupabase() {
  if (!usingSupabase()) return;
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('You must sign in to perform this action.');
  }
}

export type CreateCaseResult = {
  ok: boolean;
  error?: string;
  /** Set when the action refuses because a same-title/same-subject case exists. */
  duplicateOf?: string;
};

/**
 * Returns the existing case (id + title) that matches the title or
 * subject_name proposed by the wizard. Owner-scoped via RLS through
 * the standard server client. Trim + case-insensitive comparisons.
 */
async function findDuplicateCase(input: {
  title: string;
  subjectName: string;
}): Promise<{ id: string; title: string } | null> {
  if (!usingSupabase()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const t = input.title.trim();
  const s = input.subjectName.trim();
  if (!t || !s) return null;
  // Use ILIKE to match case-insensitively; passing the trimmed strings
  // verbatim is safe because Supabase parameterizes them.
  const { data } = await supabase
    .from('cases')
    .select('id, title')
    .eq('user_id', user.id)
    .or(`title.ilike.${t},subject_name.ilike.${s}`)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; title: string };
  return { id: row.id, title: row.title };
}

/** Render the first 8 characters of a UUID for human-readable case IDs. */
function shortenId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

export async function createCaseAction(
  _prevState: CreateCaseResult | null,
  formData: FormData,
): Promise<CreateCaseResult> {
  let createdId: string;
  // Group mode: when the wizard's "rally community support" toggle is on,
  // we skip the usual land-on-/cases and drop the organizer straight into
  // the Community Case setup for the case they just created. Read here
  // (outside the try) so it's in scope at the post-catch redirect.
  const startGroupMode = String(formData.get('startGroupMode') ?? '') === '1';
  try {
    await assertAuthIfSupabase();
    const title = String(formData.get('title') ?? '').trim();
    const subjectName = String(formData.get('subjectName') ?? '').trim();
    const subjectType = String(formData.get('subjectType') ?? 'person') as SubjectType;
    const country = String(formData.get('country') ?? '').trim();
    const state = String(formData.get('state') ?? '').trim();
    const city = String(formData.get('city') ?? '').trim();
    const caseTypeRaw = String(formData.get('caseType') ?? 'Other');
    const caseType: CaseType = (CASE_TYPES as readonly string[]).includes(caseTypeRaw)
      ? (caseTypeRaw as CaseType)
      : 'Other';
    const description = String(formData.get('description') ?? '').trim();
    const postureRaw = String(formData.get('posture') ?? 'claimant');
    const posture: Posture = postureRaw === 'defendant' ? 'defendant' : 'claimant';

    if (!title || !subjectName || !country) {
      return { ok: false, error: 'Title, subject name, and country are required.' };
    }

    // Post-trial paywall. The effective state combines Stripe (active /
    // trialing trumps everything) with the email-anchored 7-day free
    // trial (signup_history). When the mode is `expired`, the user
    // had their 7 days and didn't subscribe - they keep read access
    // to existing cases + find-counsel, but new case creation is
    // blocked until they subscribe.
    let isTrialExempt = false;
    try {
      const state = await getEffectiveTrialState();
      if (state.mode === 'expired') {
        return {
          ok: false,
          // Plain-limit copy: see the note in lib/ai.ts.
          error:
            'Your free trial has ended, so a new case cannot be created right now. Your existing cases are still there to view.',
        };
      }
      isTrialExempt = isFullAccessTrial(state);
    } catch {
      // never block creation on a state-lookup failure
    }

    // Per-tier case cap (TIER_FEATURES.caseLimit - basic/free: 1,
    // standard: 20, pro: 50). This was defined but never enforced
    // anywhere: the banner in app/cases/new/page.tsx warned a user at
    // their cap, but createCaseAction itself never checked it, so the
    // warning didn't correspond to an actual block. Trial users get
    // full access regardless of their nominal tier, matching every
    // other feature gate's trial-exemption behavior.
    if (!isTrialExempt) {
      try {
        const user = await getCurrentUser();
        if (user) {
          const sub = await getCurrentSubscription();
          // An HQ-granted trial can lift a free account to a plan level. It
          // cannot change what a payer gets: lib/trial-entitlement.ts resolves
          // a live subscription ahead of any trial.
          const trial = await currentUserTrialGrant().catch(() => undefined);
          const limit = caseLimit(sub, trial);
          if (limit !== null) {
            const supabase = createServerSupabase();
            const { count } = await supabase
              .from('cases')
              .select('id', { count: 'exact', head: true })
              // Only the user's OWN cases count against their plan limit.
              // Without this, RLS lets the count see every case they
              // collaborate on too, so a paid user invited onto many
              // matters could be wrongly blocked from creating their own.
              .eq('owner_id', user.id)
              .eq('sandbox', false)
              .neq('status', 'archived');
            if ((count ?? 0) >= limit) {
              return {
                ok: false,
                // Plain-limit copy: see the note in lib/ai.ts.
                error: `You've reached your plan's limit of ${limit} case${limit === 1 ? '' : 's'}. Archive an existing case to make room.`,
              };
            }
          }
        }
      } catch {
        // never block creation on a limit-lookup failure
      }
    }

    const validSubjectTypes: SubjectType[] = ['person', 'business', 'matter', 'state', 'entity'];
    const subject: SubjectType = validSubjectTypes.includes(subjectType) ? subjectType : 'person';

    const get = (k: string) => String(formData.get(k) ?? '').trim();
    const profile: SubjectProfile = {};
    const map: [string, keyof SubjectProfile][] = [
      ['subj_legalName', 'legalName'],
      ['subj_alsoKnownAs', 'alsoKnownAs'],
      ['subj_relationship', 'relationship'],
      ['subj_address', 'address'],
      ['subj_email', 'email'],
      ['subj_phone', 'phone'],
      ['subj_website', 'website'],
      ['subj_notes', 'notes'],
      ['subj_dateOfBirthApprox', 'dateOfBirthApprox'],
      ['subj_registrationNumber', 'registrationNumber'],
      ['subj_businessType', 'businessType'],
      ['subj_primaryContactName', 'primaryContactName'],
      ['subj_agencyOrDepartment', 'agencyOrDepartment'],
      ['subj_jurisdictionLevel', 'jurisdictionLevel'],
    ];
    for (const [formKey, profileKey] of map) {
      const v = get(formKey);
      if (v) profile[profileKey] = v;
    }

    // Hearing fields are optional at creation time. Empty datetime-local input
    // ('') becomes null. Browsers send local time without a TZ suffix; we trust
    // the user's local TZ and convert via Date.parse. A bad value here would
    // throw "Invalid time value" - guarded so we surface a friendly message
    // instead of a server-side exception.
    const hearingRaw = String(formData.get('hearingAt') ?? '').trim();
    let hearingAt: string | null = null;
    if (hearingRaw) {
      const parsed = new Date(hearingRaw);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: 'Hearing date is not a valid date and time.' };
      }
      hearingAt = parsed.toISOString();
    }
    const hearingLocation = String(formData.get('hearingLocation') ?? '').trim() || null;
    const hearingNotes = String(formData.get('hearingNotes') ?? '').trim() || null;

    // Duplicate guard: people occasionally re-submit the wizard or
    // genuinely forget they already opened a matter. If a case with
    // the same title (case-insensitive trim) OR the same subject_name
    // already exists for this user, surface the existing case ID and
    // suggest they update it instead of creating a clone. Pass
    // `?force=1` on the form to bypass the check.
    const force = String(formData.get('force') ?? '') === '1';
    if (!force) {
      const existing = await findDuplicateCase({
        title,
        subjectName,
      }).catch(() => null);
      if (existing) {
        return {
          ok: false,
          error:
            `You already have a case for "${existing.title}" (case ${shortenId(existing.id)}). ` +
            `Open it from your case list and update it there instead of creating a duplicate. ` +
            `If you really need a separate file, click "Create anyway" below.`,
          duplicateOf: existing.id,
        };
      }
    }

    const created = await createCase({
      title,
      subjectName,
      subjectType: subject,
      subjectProfile: profile,
      jurisdiction: {
        country,
        state: state || undefined,
        city: city || undefined,
      },
      caseType,
      description,
      posture,
      hearingAt,
      hearingLocation,
      hearingNotes,
    });
    createdId = created.id;
  } catch (err) {
    // Log the unredacted error so it shows up in Vercel runtime logs
    // (the user only sees the friendly message returned below).
    console.error('[createCaseAction] failed', err);
    const message =
      err instanceof Error
        ? err.message || 'Could not create case.'
        : 'Could not create case.';
    return { ok: false, error: message };
  }

  // Best-effort activity log + owner notification.
  await logCaseEvent({ caseId: createdId, eventType: 'case_created' });

  // Attach any existing vault / contract items the user picked in the
  // wizard's Evidence step. These were serialized into the `attachedItems`
  // hidden field but the action never read them, so the selection was
  // silently discarded. Best-effort + bounded so it can't fail or unduly
  // slow case creation.
  await attachSelectedEvidence(createdId, String(formData.get('attachedItems') ?? ''));

  // Auto-review with a hard 2-second cap so the redirect is fast.
  //
  // We used to AWAIT runReview here, which made the user stare at
  // the "Creating your case file" overlay for 5-30 seconds while
  // Claude generated the issue-spotting summary - making it look
  // like the wizard was broken. Race the review against a 2s
  // timeout: we attach it when the call is fast, otherwise the
  // user lands on /cases with the case visible and can re-run the
  // review from the case detail page.
  await Promise.race([
    (async () => {
      try {
        const fresh = await getCase(createdId);
        if (fresh) {
          const review = await runReview(fresh, []);
          await saveReview(review);
          await logCaseEvent({ caseId: createdId, eventType: 'review_run' });
        }
      } catch (err) {
        console.error('[createCaseAction] auto-review failed', err);
      }
    })(),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);

  // Redirect outside the try/catch so the NEXT_REDIRECT control-flow
  // exception isn't swallowed. Land on the case list (not the detail
  // page) so the user sees the new case appear in their dashboard
  // and orient before they dive in. They can click it from there.
  //
  // Exception: group mode. If the organizer chose to rally community
  // support, take them straight to the Community Case editor for the
  // case they just created so they can publish the public page.
  revalidatePath('/cases');
  if (startGroupMode) {
    redirect(`/cases/${createdId}/community`);
  }
  redirect('/cases');
}

/** Upper bound on how many existing items one new case can pull in, so a
 *  huge selection can't turn case creation into a long copy job. */
const MAX_ATTACHED_EVIDENCE = 25;

/**
 * Where a person's own vault files live, per source.
 *
 * The two source tables do NOT share a convention, so this takes the source
 * rather than assuming one layout. Both are written in exactly one place:
 *   user_receipts.file_path  -> `<user-id>/receipts/<uuid>/<name>`,
 *                               lib/receipts-actions.ts uploadReceiptAction
 *   user_contracts.file_path -> `<owner-id>/contracts/<uuid>/<name>`,
 *                               lib/contracts-actions.ts uploadContractAction
 *
 * The contract owner is the FIRM for a firm-side upload and the USER for a
 * consumer one, and the two are mutually exclusive on the row: a firm upload
 * stores `user_id: null`. Every read on this path is filtered to the caller's
 * own `user_id`, so the only contract layout reachable here is the consumer
 * one, and the owner is always the caller. A firm-owned path therefore cannot
 * satisfy this prefix, which is the point: a row carrying one was not written
 * by either uploader.
 */
function vaultPrefix(userId: string, source: 'vault' | 'contract'): string {
  return `${userId}/${source === 'vault' ? 'receipts' : 'contracts'}/`;
}

/**
 * A stored path may be handed to the SERVICE-ROLE client only when it sits
 * inside this user's own vault prefix for that source.
 *
 * `file_path` is a plain column on both tables, and neither insert policy
 * constrains it. Filtering the ROW by `user_id` proves the row is the caller's
 * and proves nothing at all about the path inside it, so without this a person
 * could store any path on a row of their own and have the service role copy a
 * stranger's document into their case as an exhibit.
 *
 * Rejects, never rewrites. A path that does not match was not written by
 * either uploader, and repointing it at something plausible would hide that.
 */
function isOwnVaultPath(
  userId: string,
  source: 'vault' | 'contract',
  path: string | null | undefined,
): boolean {
  if (!userId || !path) return false;
  // A traversal segment would let a matching prefix still resolve elsewhere.
  if (path.includes('..')) return false;
  return path.startsWith(vaultPrefix(userId, source));
}

/**
 * Copy the vault receipts / contracts the user selected in the new-case
 * wizard's Evidence step into the new case as exhibits.
 *
 * `raw` is the JSON the EvidencePicker serialized into the `attachedItems`
 * hidden field: `[{ id, source: 'vault' | 'contract' }]`. For each item we
 * re-verify ownership of the row AND confinement of its stored path, download
 * the source file from its bucket, and hand it to addExhibit so it goes
 * through the same labeling + magic-byte screening as any other exhibit
 * upload.
 *
 * Still best-effort per item, and deliberately so: this runs AFTER the case
 * row is committed and the action redirects, so there is no whole-batch
 * failure available that would not throw away a case the person already
 * finished, and one refused item must not cost them the other twenty-four.
 * What is not best-effort is telling them. Anything that did not attach is
 * counted and reported in one notification against the new case, because an
 * incomplete evidence packet that nobody mentions is its own defect.
 */
async function attachSelectedEvidence(caseId: string, raw: string): Promise<void> {
  if (!raw || !usingSupabase()) return;

  let items: Array<{ id: string; source: 'vault' | 'contract' }>;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    items = parsed
      .filter(
        (x): x is { id: string; source: 'vault' | 'contract' } =>
          x &&
          typeof x.id === 'string' &&
          (x.source === 'vault' || x.source === 'contract'),
      )
      .slice(0, MAX_ATTACHED_EVIDENCE);
  } catch {
    return;
  }
  if (items.length === 0) return;

  const user = await getCurrentUser();
  if (!user) return;
  const { createAdminSupabase } = await import('./supabase/admin');
  const admin = createAdminSupabase();
  if (!admin) return;

  let missed = 0;
  for (const item of items) {
    try {
      let bucket: string;
      let filePath: string;
      let mime: string | null;
      let title: string;

      if (item.source === 'vault') {
        const { data } = await admin
          .from('user_receipts')
          .select('file_path, mime_type, label')
          .eq('id', item.id)
          // Scopes the ROW to the caller. Says nothing about the path in it.
          .eq('user_id', user.id)
          .maybeSingle();
        const row = data as
          | { file_path?: string; mime_type?: string | null; label?: string | null }
          | null;
        if (!row?.file_path) {
          missed += 1;
          continue;
        }
        bucket = 'user-vault';
        filePath = row.file_path;
        mime = row.mime_type ?? null;
        title = row.label?.trim() || 'Vault item';
      } else {
        const { data } = await admin
          .from('user_contracts')
          .select('file_path, mime_type, name, firm_id')
          .eq('id', item.id)
          .eq('user_id', user.id)
          .maybeSingle();
        const row = data as
          | {
              file_path?: string;
              mime_type?: string | null;
              name?: string | null;
              firm_id?: string | null;
            }
          | null;
        if (!row?.file_path) {
          missed += 1;
          continue;
        }
        // A firm-scoped contract carries user_id null, so the filter above
        // never returns one and this always resolves to the vault. Kept
        // faithful to where contracts live rather than hard-coded, and the
        // prefix check below is what actually refuses a row claiming
        // otherwise.
        bucket = row.firm_id ? 'firm-documents' : 'user-vault';
        filePath = row.file_path;
        mime = row.mime_type ?? null;
        title = row.name?.trim() || 'Contract';
      }

      // Owning the row is not owning the path. Nothing is fetched until the
      // stored path is confirmed to sit inside this person's own prefix.
      if (!isOwnVaultPath(user.id, item.source, filePath)) {
        console.error(
          '[createCaseAction] refused an attached item whose stored path is outside the owner prefix',
          item.source,
          item.id,
        );
        missed += 1;
        continue;
      }

      const { data: blob, error: dlErr } = await admin.storage
        .from(bucket)
        .download(filePath);
      if (dlErr || !blob) {
        missed += 1;
        continue;
      }

      const dotExt = filePath.includes('.') ? `.${filePath.split('.').pop()}` : '';
      const safeTitle =
        title.replace(/[/\\<>:"|?*\n\r]+/g, ' ').trim() ||
        (item.source === 'vault' ? 'Vault item' : 'Contract');
      const file = new File([blob], `${safeTitle}${dotExt}`, {
        type: mime || blob.type || 'application/octet-stream',
      });

      const added = await addExhibit({
        caseId,
        file,
        description: `Attached from your ${
          item.source === 'vault' ? 'vault' : 'contracts'
        }: ${title}`,
        source: item.source,
      });
      // A refusal now arrives as a value rather than a throw, so it has to be
      // counted here explicitly. It used to land in the catch below by virtue
      // of being thrown; without this line a refused item would be silently
      // counted as attached, which is the failure mode the notification
      // beneath exists to prevent.
      if (!added.ok) {
        console.error(
          '[createCaseAction] attached item refused',
          item.id,
          added.error,
        );
        missed += 1;
      }
    } catch (err) {
      console.error('[createCaseAction] attach evidence failed', item.id, err);
      missed += 1;
    }
  }

  // Say so. Silently handing someone a case that is short of the evidence they
  // picked is how they find out in front of a judge.
  if (missed > 0) {
    try {
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: user.id,
        type: 'system',
        title:
          missed === 1
            ? 'One item did not attach to your new case'
            : `${missed} items did not attach to your new case`,
        body: 'You can add them from the case page whenever you are ready.',
        link: `/cases/${caseId}`,
        caseId,
      });
    } catch (err) {
      console.error('[createCaseAction] could not report unattached items', err);
    }
  }
}

/**
 * Classify a free-form case description into a CASE_TYPES bucket.
 * Best-effort - returns null on too-short text or any error so the
 * smart-assist wizard can degrade silently. No DB writes; the user
 * still picks the final value before submit.
 */
export async function suggestCaseTypeAction(description: string): Promise<string | null> {
  if (typeof description !== 'string') return null;
  return await classifyCaseType(description);
}

/**
 * The calm line shown when the upload hit something unexpected.
 *
 * Distinct from every refusal above it: a refusal names the file and says what
 * to do next, whereas this covers a storage outage or a failed database write,
 * where there is nothing the person did wrong and nothing they can correct.
 * The support reference is appended when Next generated one, matching what
 * app/cases/[id]/error.tsx already shows on this surface.
 */
const UPLOAD_INTERNAL_ERROR =
  'That upload did not finish. Your case and everything already uploaded are safe. Please try again in a moment.';

/**
 * Add one exhibit to a personal case.
 *
 * Returns its refusal rather than throwing it, for the same reason
 * rescanExhibitAction and inviteCollaboratorAction do: React strips an error's
 * message when it crosses the Server Action boundary in a production build, so
 * a thrown "This file is not a valid image." reached the person as "An error
 * occurred in the Server Components render. The specific message is omitted in
 * production builds...". Someone uploading evidence in a legal matter then had
 * no way to learn what was wrong with their file.
 */
export async function uploadExhibitAction(
  caseId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  if (usingSupabase() && !(await getCurrentUser())) {
    return { ok: false, error: 'Please sign in again, then re-add this file.' };
  }
  const file = formData.get('file');
  const description = String(formData.get('description') ?? '').trim();
  const incidentDateRaw = String(formData.get('incidentDate') ?? '').trim();
  const source = String(formData.get('source') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Please choose a file to upload.' };
  }

  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: 'File is larger than the 50MB limit. Please add a smaller copy.',
    };
  }

  let exhibit;
  try {
    const added = await addExhibit({
      caseId,
      file,
      description,
      incidentDate: incidentDateRaw || null,
      source: source || null,
      category: category || null,
    });
    if (!added.ok) return { ok: false, error: added.error };
    exhibit = added.exhibit;
  } catch (err) {
    // Not a refusal: a storage or database failure. The real message is a
    // PostgREST/S3 string, so the person gets calm copy and the reference
    // Next already logged next to the stack.
    console.error('[uploadExhibitAction] upload failed', err);
    const reference = displayableDigest(
      (err as { digest?: unknown } | null)?.digest,
    );
    return {
      ok: false,
      error: reference
        ? `${UPLOAD_INTERNAL_ERROR} Reference: ${reference}`
        : UPLOAD_INTERNAL_ERROR,
    };
  }

  // Auto-scan images and PDFs synchronously - it takes 3-8s and gives the
  // user immediate feedback. Audio/video are bigger and Whisper can be slow,
  // so we leave those to the manual Transcribe button on the exhibit row.
  const ct = (file.type || '').toLowerCase();
  const looksScannable =
    ct.startsWith('image/') || ct === 'application/pdf';
  if (looksScannable) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const scan = await scanDocument({
        fileBuffer: buf,
        mediaType: ct,
        fileName: file.name,
      });
      await saveExhibitScan(exhibit.id, scan);
    } catch (err) {
      // Never block the upload on scan failure - user can re-trigger from UI.
      console.warn('[scan] auto-scan failed:', err instanceof Error ? err.message : err);
    }
  }

  await logCaseEvent({
    caseId,
    eventType: 'exhibit_uploaded',
    metadata: {
      label: exhibit.label,
      fileName: exhibit.fileName,
      category: exhibit.category ?? null,
    },
  });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
  return { ok: true };
}

/**
 * Add one exhibit to a personal case from a LINK the person pasted.
 *
 * WHY THIS DOOR EXISTS. Uploading sends the file through a Server Action, and
 * the platform caps a serverless function's REQUEST BODY near 4.5MB before any
 * framework code runs (lib/upload-transport.ts has the whole account). A
 * fetch made by the SERVER never crosses that boundary. Nothing new is being
 * invented here: it is exactly how the 40MB objects already sitting in the
 * exhibits bucket got there.
 *
 * WHAT THE LINK IS FOR, AND WHAT IT IS NOT FOR. It is used ONCE, right here,
 * to download the bytes. It is never followed again. Advottic does not keep a
 * pointer to somebody else's URL and stream the evidence from it later,
 * because a remote file can be changed, moved or deleted by whoever hosts it,
 * and the host may be the opposing party. An exhibit that can change after it
 * is filed is not an exhibit. We take the bytes, and the exhibit IS those
 * bytes. The URL and the moment of the fetch are recorded next to it as
 * provenance, in exhibits.source, which is the column that already means
 * exactly that.
 *
 * THE TWO CONTROLS, AND THE FACT THAT NEITHER IS RE-IMPLEMENTED HERE.
 *
 *   1. fetchRemoteEvidence does the download. It refuses hosts resolving into
 *      private, loopback, link-local, carrier-NAT and cloud-metadata ranges,
 *      RE-CHECKS on every redirect hop, and bounds the body with a byte cap
 *      and a timeout. This action calls it and passes it the ceiling. There
 *      is no second fetch in this file and no bypass of it.
 *
 *   2. addExhibit writes the exhibit. It runs screenAuthenticatedUpload on
 *      the bytes BEFORE anything is written to the bucket, allocates the
 *      label by position, and inserts the row. A fetched file is UNTRUSTED
 *      INPUT in exactly the way an uploaded one is, so it goes through
 *      exactly the same screen.
 *
 * WHY screenAuthenticatedUpload AND NOT screenStoredObject. Both run the same
 * rules; they differ only in ordering. screenStoredObject exists for the one
 * transport where our server never touches the bytes on their way in, so the
 * screen has to run after the object lands and delete it on refusal. That is
 * not this transport. Here the bytes are already in this process, in memory,
 * before anything is written, so the STRONGER ordering is available and is
 * what is used: a file that fails the screen never reaches the bucket at all,
 * and no row is written, so there is nothing to clean up and no window in
 * which an unscreened object exists.
 *
 * OWNER ONLY, CHECKED HERE. Every server action is a public HTTP endpoint, so
 * the check cannot live in the page that decides whether to draw the form.
 * This is stricter than uploadExhibitAction, which leans on RLS alone, and
 * deliberately so: this endpoint makes an OUTBOUND request to an address the
 * caller chooses, which is the one thing on this surface worth holding to the
 * narrowest possible set of callers. The firm-side equivalent
 * (importCaseEvidenceFromUrlsAction) gates itself for the same reason.
 *
 * Returns its refusal rather than throwing it, like every other action on
 * this surface: React strips an error's message crossing the Server Action
 * boundary in a production build, and "that link returned a web page, not a
 * file" is a sentence somebody trying to file evidence needs to read.
 */
export async function addExhibitFromLinkAction(
  caseId: string,
  input: {
    url: string;
    description?: string;
    incidentDate?: string | null;
    source?: string | null;
    category?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const owned = await loadOwnedCase(caseId, NOT_YOUR_EXHIBIT);
  if (!owned.ok) return { ok: false, error: owned.error };

  const {
    LINK_IMPORT_MAX_BYTES,
    classifyLinkFailure,
    explainScreenRefusal,
    linkProvenanceSource,
    looksLikeWebPage,
    normalizeExhibitLink,
    sanitizeImportedFileName,
    sharingPageMessage,
  } = await import('./exhibit-link-import');

  const link = normalizeExhibitLink(input?.url);
  if (!link.ok) return { ok: false, error: link.failure.message };

  const { fetchRemoteEvidence } = await import('./remote-fetch');
  const fetchedAt = new Date().toISOString();
  const fetched = await fetchRemoteEvidence(link.url, LINK_IMPORT_MAX_BYTES);
  if (!fetched.ok) {
    return { ok: false, error: classifyLinkFailure(fetched.error).message };
  }

  // A sharing page is HTML, and screenAuthenticatedUpload below would refuse
  // it anyway. It is named HERE so the person is told the truth about their
  // link instead of reading "HTML/SVG content is not an accepted document
  // type." This check only ever refuses MORE than the screen; it can never
  // let anything through that the screen would have stopped.
  if (looksLikeWebPage(fetched.file.mime, fetched.file.buffer)) {
    return { ok: false, error: sharingPageMessage(link.url) };
  }

  const fileName = sanitizeImportedFileName(fetched.file.name, fetched.file.mime);
  // The name is cleaned for what people SEE and for what an export writes to
  // disk. It is NOT what keeps a hostile name out of the storage path:
  // addExhibit builds that path as userId/caseId/uuid + its own sanitised
  // extension, so no part of this name reaches it intact. Cleaning it twice
  // in two places is how those two rules would drift apart.
  const file = new File([new Uint8Array(fetched.file.buffer)], fileName, {
    type: fetched.file.mime || 'application/octet-stream',
  });

  let exhibit;
  try {
    // THE SAME WRITER THE UPLOAD FORM USES. Labels are allocated by position,
    // so a second writer would hand out a duplicate "Exhibit C".
    const added = await addExhibit({
      caseId,
      file,
      description: String(input?.description ?? '').trim(),
      incidentDate: input?.incidentDate || null,
      source: linkProvenanceSource({
        url: link.url,
        fetchedAt,
        userSource: input?.source ?? null,
      }),
      category: input?.category || null,
    });
    if (!added.ok) {
      // A refusal from the screen, reworded for this path but never overridden.
      return { ok: false, error: explainScreenRefusal(added.error, link.url).message };
    }
    exhibit = added.exhibit;
  } catch (err) {
    console.error('[addExhibitFromLinkAction] import failed', err);
    const reference = displayableDigest((err as { digest?: unknown } | null)?.digest);
    return {
      ok: false,
      error: reference
        ? `${UPLOAD_INTERNAL_ERROR} Reference: ${reference}`
        : UPLOAD_INTERNAL_ERROR,
    };
  }

  // From this point on the exhibit is indistinguishable from an uploaded one,
  // and that is the requirement: same label sequence, same auto-scan, same
  // case event, same packet treatment. The only difference is what is written
  // in its Source line.
  const ct = (exhibit.fileType || '').toLowerCase();
  if (ct.startsWith('image/') || ct === 'application/pdf') {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const scan = await scanDocument({
        fileBuffer: buf,
        mediaType: ct,
        fileName: exhibit.fileName,
      });
      await saveExhibitScan(exhibit.id, scan);
    } catch (err) {
      console.warn('[scan] auto-scan failed:', err instanceof Error ? err.message : err);
    }
  }

  await logCaseEvent({
    caseId,
    eventType: 'exhibit_uploaded',
    metadata: {
      label: exhibit.label,
      fileName: exhibit.fileName,
      category: exhibit.category ?? null,
    },
  });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
  return { ok: true };
}

/**
 * Start a direct browser-to-storage upload for a file too big for the
 * request body, and hand back a one-path, short-lived write token.
 *
 * Every gate lives in mintExhibitUploadUrl (signed in, case visible through
 * RLS, size within the ceiling). This wrapper exists because a 'use server'
 * export is a public endpoint, so the action surface is kept to the two calls
 * the form actually makes and nothing else.
 */
export async function mintExhibitUploadAction(
  caseId: string,
  fileName: string,
  fileSize: number,
): Promise<{ ok: boolean; error?: string; exhibitId?: string; path?: string; token?: string }> {
  try {
    const minted = await mintExhibitUploadUrl({
      caseId,
      fileName: String(fileName ?? ''),
      fileSize: Number(fileSize),
    });
    if (!minted.ok) return { ok: false, error: minted.error };
    return { ok: true, exhibitId: minted.exhibitId, path: minted.path, token: minted.token };
  } catch (err) {
    console.error('[mintExhibitUploadAction] failed', err);
    return { ok: false, error: UPLOAD_INTERNAL_ERROR };
  }
}

/**
 * Finish a direct upload: screen the object that landed, then record it.
 *
 * The refusal from the screen is returned as a VALUE, for the same reason
 * every other refusal on this surface is: React strips an error's message
 * crossing the Server Action boundary in a production build, and "HTML/SVG
 * content is not an accepted document type." is a sentence somebody needs to
 * read. Throwing it would put them back where this whole fix started, staring
 * at a message about their connection.
 */
export async function finalizeExhibitUploadAction(
  caseId: string,
  input: {
    exhibitId: string;
    path: string;
    fileName: string;
    fileType: string;
    description?: string;
    incidentDate?: string | null;
    source?: string | null;
    category?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (usingSupabase() && !(await getCurrentUser())) {
    return { ok: false, error: 'Please sign in again, then re-add this file.' };
  }

  let exhibit;
  try {
    const added = await addExhibitFromStoredObject({
      caseId,
      exhibitId: String(input?.exhibitId ?? ''),
      path: input?.path,
      fileName: String(input?.fileName ?? ''),
      fileType: String(input?.fileType ?? ''),
      description: String(input?.description ?? '').trim(),
      incidentDate: input?.incidentDate || null,
      source: input?.source || null,
      category: input?.category || null,
    });
    if (!added.ok) return { ok: false, error: added.error };
    exhibit = added.exhibit;
  } catch (err) {
    console.error('[finalizeExhibitUploadAction] finalize failed', err);
    const reference = displayableDigest((err as { digest?: unknown } | null)?.digest);
    return {
      ok: false,
      error: reference
        ? `${UPLOAD_INTERNAL_ERROR} Reference: ${reference}`
        : UPLOAD_INTERNAL_ERROR,
    };
  }

  // Auto-scan the types that are quick to read, matching the server-action
  // path. Done through scanOneExhibit, which fetches the object from storage
  // itself, because on this path the bytes were never in this process.
  const ct = (exhibit.fileType || '').toLowerCase();
  if (ct.startsWith('image/') || ct === 'application/pdf') {
    try {
      await scanOneExhibit(exhibit);
    } catch (err) {
      console.warn('[scan] auto-scan failed:', err instanceof Error ? err.message : err);
    }
  }

  await logCaseEvent({
    caseId,
    eventType: 'exhibit_uploaded',
    metadata: {
      label: exhibit.label,
      fileName: exhibit.fileName,
      category: exhibit.category ?? null,
    },
  });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
  return { ok: true };
}

/**
 * Scan one exhibit.
 *
 * Returns its refusal rather than throwing it. A thrown message does not
 * survive the Server Action boundary in a production build: React replaces it
 * with a digest, and the caller reads back "An error occurred in the Server
 * Components render...". Every reason below was written to be read by a
 * person, so it has to travel as a value. Same shape, and same reason, as
 * inviteCollaboratorAction.
 */
export async function rescanExhibitAction(
  exhibitId: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAuthIfSupabase();
  const exhibit = await getExhibitById(exhibitId);
  if (!exhibit) return { ok: false, error: 'Exhibit not found.' };
  const result = await scanOneExhibit(exhibit);
  if (result.ok) revalidatePath(`/cases/${exhibit.caseId}`);
  return result;
}

/**
 * Read one exhibit and store what it says. The whole of it, so there is one
 * scanning path and not two.
 *
 * Lifted out of `rescanExhibitAction` unchanged when the bulk action arrived.
 * Every refusal below was written to be read by a person and is returned
 * rather than thrown, because React strips an error's message at the Server
 * Action boundary in a production build.
 *
 * Does NOT call revalidatePath. A bulk run over seventeen exhibits would
 * otherwise revalidate the same case seventeen times; its caller does it once
 * at the end.
 */
async function scanOneExhibit(
  exhibit: Exhibit,
): Promise<{ ok: boolean; error?: string }> {
  const exhibitId = exhibit.id;
  // Three early failure modes that were silently swallowed before:
  //   (1) ANTHROPIC_API_KEY missing on the server -> scanDocument
  //       returns isDemo=true with a "demo response" placeholder,
  //       which renders fine but does nothing useful for the user.
  //   (2) getExhibitFileBuffer fails (RLS, stale path, deleted
  //       object) and returns null -> a generic "could not read"
  //       with no diagnostic.
  //   (3) MIME type missing / octet-stream -> scanDocument bails
  //       early with an unhelpful "cannot be auto-scanned" line.
  const apiKeyPresent =
    Boolean(process.env.ANTHROPIC_API_KEY?.trim()) ||
    Boolean(process.env.CLAUDE_API_KEY?.trim());
  if (!apiKeyPresent) {
    // An operator instruction is not something to put in front of a person
    // who is trying to read their own evidence, so they get the calm line and
    // the server log keeps the detail.
    console.error('[rescanExhibitAction] ANTHROPIC_API_KEY is not set on this deployment');
    return { ok: false, error: AI_UNAVAILABLE_MESSAGE };
  }
  const buf = await getExhibitFileBuffer(exhibit);
  if (!buf || buf.byteLength === 0) {
    return {
      ok: false,
      error: `Could not read the file (${exhibit.fileName}). It may have been deleted from storage, or your session has expired - try refreshing.`,
    };
  }
  // Which reader this file goes to lives in lib/exhibit-reading.ts, which the
  // exhibit row in the UI also calls, so the button a person is offered and
  // the path this takes cannot disagree. The MIME normalisation that used to
  // sit here inline moved there with it: some browsers upload with no content
  // type at all, so the file name is consulted too.
  const route = classifyExhibitForReading(exhibit);
  if (route.kind === 'unsupported' || route.kind === 'transcribe') {
    return {
      ok: false,
      error: unsupportedScanMessage(
        exhibit.fileType,
        route.kind === 'unsupported' ? route.reason : undefined,
      ),
    };
  }

  let scan;
  try {
    if (route.kind === 'extract') {
      // A spreadsheet and a Word document are not pictures. Their text is
      // pulled out first and the model reads that, which is the only way an
      // expense sheet or a payment tracker can be read at all.
      const extracted = await extractExhibitText({ buffer: buf, format: route.format });
      if (extracted.error) return { ok: false, error: extracted.error };
      if (!extracted.text.trim()) {
        // Nothing readable is a refusal with a reason. It must never be
        // stored as a successful scan of an empty document.
        return {
          ok: false,
          error: `Nothing could be read out of ${exhibit.fileName}. Please open it, check that it has content, and re-upload it.`,
        };
      }
      scan = await scanExtractedText({
        text: extracted.text,
        fileName: exhibit.fileName,
        sourceLabel: route.label,
        truncated: extracted.truncated,
        truncationNote: extracted.truncationNote,
        readNote: extractedTextReadNote(route.label, extracted.truncationNote),
      });
    } else {
      scan = await scanDocument({
        fileBuffer: buf,
        mediaType: route.mediaType,
        fileName: exhibit.fileName,
      });
    }
  } catch (err) {
    // calmAiMessage, not err.message: only an error that promises a
    // user-safe sentence gets to supply one. Anything else (a bug, a
    // provider dump) falls back to the calm line.
    return { ok: false, error: calmAiMessage(err, AI_UNAVAILABLE_MESSAGE) };
  }
  // A placeholder must never be stored as a real reading of somebody's
  // evidence. isRealScan is the one definition of that, shared with the bulk
  // runner above and with everything that feeds scan_data back to a model; a
  // hand-written copy of its rule used to live here and would have had to be
  // updated twice.
  if (!isRealScan(scan)) {
    return {
      ok: false,
      error: scan.summary?.includes('not actually scanned')
        ? AI_UNAVAILABLE_MESSAGE
        : scan.summary || 'Scan unavailable for this file.',
    };
  }
  await saveExhibitScan(exhibitId, scan);
  return { ok: true };
}

/** What happened to one exhibit during a bulk run. */
export type BulkScanOutcome = {
  exhibitId: string;
  label: string;
  fileName: string;
  status: 'scanned' | 'failed' | 'not-attempted';
  /** Present for 'failed' and 'not-attempted'. Already calm, already plain. */
  message?: string;
};

export type BulkScanResult = {
  /** False only when the whole run was refused before any exhibit was tried. */
  ok: boolean;
  /** Present only when ok is false. */
  error?: string;
  outcomes: BulkScanOutcome[];
  scanned: number;
  failed: number;
  /** Exhibits still unread after this run, including the ones not attempted. */
  stillUnread: number;
};

/**
 * How many exhibits one press of the button will attempt.
 *
 * A scan is an Anthropic vision call over a file this service loads whole into
 * memory, and it takes single-digit seconds. Nineteen of them in one request
 * would outrun the platform's function timeout and the person would be left
 * with a dead page and no idea which exhibits were saved. The run stops at
 * this many and says how many are left, which is slower but never loses a
 * result.
 */
const BULK_SCAN_BATCH = 6;

/**
 * Read every exhibit on a case that has not been read yet.
 *
 * SEQUENTIAL, ONE AT A TIME, DELIBERATELY. Not for politeness:
 *
 *   - `getExhibitFileBuffer` pulls the whole file into memory and the upload
 *     limit is 50MB. Six of those in flight together is 300MB against a
 *     serverless memory ceiling, and the failure mode is the process dying
 *     mid-run with nothing written.
 *   - Concurrent vision calls hit provider rate limits, and a rate-limit
 *     rejection arrives looking like a failure to read the document. Somebody
 *     preparing for court would then be told their evidence could not be read
 *     when the truth is that we asked too fast.
 *
 * One at a time makes every failure attributable to the exhibit it names.
 *
 * NEVER THROWS PAST A SINGLE EXHIBIT. Partial failure is the expected case
 * here, not an exception: on the case that prompted this, seventeen exhibits
 * had been sitting unread for weeks and some of them may still fail. A throw
 * would discard the successes alongside the failures, so each exhibit is
 * wrapped and its outcome recorded either way.
 */
export async function rescanUnreadExhibitsAction(
  caseId: string,
): Promise<BulkScanResult> {
  const empty = { outcomes: [], scanned: 0, failed: 0, stillUnread: 0 };
  if (usingSupabase() && !(await getCurrentUser())) {
    return { ok: false, error: 'Please sign in again, then try this once more.', ...empty };
  }
  await assertAuthIfSupabase();

  const caseRecord = await getCase(caseId);
  if (!caseRecord) return { ok: false, error: 'Case not found.', ...empty };

  let exhibits: Exhibit[];
  try {
    exhibits = await listExhibits(caseId);
  } catch {
    return {
      ok: false,
      error: 'Could not load this case just now. Please try again in a moment.',
      ...empty,
    };
  }

  // An exhibit counts as unread when nothing was ever stored for it, and also
  // when what was stored is the placeholder a keyless deployment produces.
  // The placeholder's own summary says the document was not scanned, so
  // leaving it in place would mean the button reports nothing to do on a case
  // where nothing has been read.
  const unread = exhibits.filter((e) => !isRealScan(e.scanData));
  const batch = unread.slice(0, BULK_SCAN_BATCH);

  const outcomes: BulkScanOutcome[] = [];
  let scanned = 0;
  let failed = 0;

  for (const exhibit of batch) {
    let result: { ok: boolean; error?: string };
    try {
      result = await scanOneExhibit(exhibit);
    } catch (err) {
      // scanOneExhibit returns its refusals, so reaching here means something
      // unplanned. It stops this exhibit and nothing else.
      console.error('[rescanUnreadExhibitsAction] unexpected failure', exhibit.id, err);
      result = { ok: false, error: calmAiMessage(err, AI_UNAVAILABLE_MESSAGE) };
    }
    if (result.ok) {
      scanned += 1;
      outcomes.push({
        exhibitId: exhibit.id,
        label: exhibit.label,
        fileName: exhibit.fileName,
        status: 'scanned',
      });
    } else {
      failed += 1;
      outcomes.push({
        exhibitId: exhibit.id,
        label: exhibit.label,
        fileName: exhibit.fileName,
        status: 'failed',
        message: result.error || 'This one could not be read.',
      });
    }
  }

  for (const exhibit of unread.slice(BULK_SCAN_BATCH)) {
    outcomes.push({
      exhibitId: exhibit.id,
      label: exhibit.label,
      fileName: exhibit.fileName,
      status: 'not-attempted',
      message: 'Not reached in this run. Press the button again to continue.',
    });
  }

  if (scanned > 0) {
    revalidatePath(`/cases/${caseId}`);
    revalidatePath('/cases');
  }

  return {
    ok: true,
    outcomes,
    scanned,
    failed,
    stillUnread: unread.length - scanned,
  };
}

/** Transcribe one audio or video exhibit. Returns its refusal for the same
 *  reason rescanExhibitAction does: a thrown message dies at the boundary. */
export async function transcribeExhibitAction(
  exhibitId: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAuthIfSupabase();
  const exhibit = await getExhibitById(exhibitId);
  if (!exhibit) return { ok: false, error: 'Exhibit not found.' };
  // The same question the Scan path asks, answered by the same module rather
  // than by a second copy of the rule. This used to test the content type
  // alone, which refused a .m4a voice memo whenever the browser sent it with
  // no content type or as application/octet-stream. See
  // classifyExhibitForReading in lib/exhibit-reading.ts.
  const mediaRoute = classifyExhibitForReading(exhibit);
  if (mediaRoute.kind !== 'transcribe') {
    return { ok: false, error: 'Only audio or video files can be transcribed.' };
  }
  // A transcript the person typed themselves is not overwritten by this path.
  //
  // saveExhibitScan replaces scan_data outright and nothing keeps the previous
  // value, so one press of Re-transcribe on an exhibit somebody spent an
  // evening transcribing would destroy that text with no way back. It is worse
  // than it sounds while automatic transcription is gated off: transcribeMedia
  // returns a placeholder marked unsupported in that case, so the trade is a
  // person's whole transcript for a sentence saying the feature is
  // unavailable. Their own text wins, and they are told why.
  if (isManualTranscript(exhibit.scanData)) {
    return {
      ok: false,
      error:
        'This exhibit already has a transcript that was typed in by hand, and transcribing it again would replace that text. Edit the transcript instead. Nothing was changed.',
    };
  }
  const buf = await getExhibitFileBuffer(exhibit);
  if (!buf) return { ok: false, error: 'Could not read the underlying file.' };
  let scan;
  try {
    scan = await transcribeMedia({
      fileBuffer: buf,
      mediaType: mediaRoute.mediaType,
      fileName: exhibit.fileName,
    });
  } catch (err) {
    return { ok: false, error: calmAiMessage(err, AI_UNAVAILABLE_MESSAGE) };
  }
  await saveExhibitScan(exhibitId, scan);
  revalidatePath(`/cases/${exhibit.caseId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Changing an exhibit after it has been uploaded
//
// Until these existed the only exhibit actions were upload, rescan and
// transcribe. Nothing could correct a description, nothing could state when
// the event happened, and nothing could take a duplicate out of a packet.
//
// EVERY ONE OF THESE IS A PUBLIC HTTP ENDPOINT. The page decides whether to
// draw a button; it decides nothing about who may call the action. So each one
// resolves the exhibit, then resolves the case that exhibit belongs to, then
// confirms the caller owns that case, through the same `loadOwnedCase` the
// composition actions use. Passing somebody else's exhibit id gets the refusal
// below and no write.
//
// They all use the USER-scoped Supabase client, never the service-role client,
// so the exhibits RLS policy is a second independent check underneath the
// ownership check rather than something bypassed by an admin key.
//
// And they all return their refusal rather than throwing it, because React
// strips an error's message crossing the Server Action boundary in a
// production build and the person reads a digest instead of the sentence.
// Same shape, and same reason, as rescanExhibitAction above.
// ---------------------------------------------------------------------------

const NOT_YOUR_EXHIBIT =
  'Only the person who opened this case can change its exhibits. Nothing was changed.';

/** Resolve an exhibit and confirm the caller owns the case it sits on. */
async function loadOwnedExhibit(
  exhibitId: string,
): Promise<{ ok: true; exhibit: Exhibit } | { ok: false; error: string }> {
  if (typeof exhibitId !== 'string' || !exhibitId.trim()) {
    return { ok: false, error: 'Missing exhibit id.' };
  }
  const exhibit = await getExhibitById(exhibitId);
  if (!exhibit) return { ok: false, error: 'Exhibit not found.' };
  const owned = await loadOwnedCase(exhibit.caseId, NOT_YOUR_EXHIBIT);
  if (!owned.ok) return { ok: false, error: owned.error };
  return { ok: true, exhibit };
}

/**
 * Change what the person wrote ABOUT an exhibit: the description, the date the
 * event happened, where the evidence came from, and its category.
 *
 * NOT the file and NOT the label. There is no code path in this action, in
 * lib/storage.ts updateExhibitDetails, or in the payload builder either of
 * them uses, that can write storage_path, file_name, file_size, file_type,
 * label or scan_data. The bytes are the evidence. The label is how a court
 * refers to this document, and a hand-typed label makes every existing
 * reference to it point somewhere else.
 *
 * `incident_date` is the one that changes what a court sees: it is what the
 * chronology is ordered by, and most of the exhibits on a real case have never
 * had one. It is normalized by normalizeExhibitDetails, which parses only a
 * date naming one specific day and returns a plain YYYY-MM-DD string built
 * from UTC arithmetic, so the day cannot move.
 */
export async function updateExhibitDetailsAction(
  exhibitId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const owned = await loadOwnedExhibit(exhibitId);
  if (!owned.ok) return { ok: false, error: owned.error };

  const { normalizeExhibitDetails } = await import('./exhibit-withdrawal');
  const normalized = normalizeExhibitDetails({
    description: formData.get('description'),
    incidentDate: formData.get('incidentDate'),
    source: formData.get('source'),
    category: formData.get('category'),
    currentCategory: owned.exhibit.category ?? null,
  });
  if (!normalized.ok) return { ok: false, error: normalized.error };

  let written;
  try {
    written = await updateExhibitDetails({
      exhibitId,
      details: normalized.value,
    });
  } catch (err) {
    console.error('[updateExhibitDetailsAction] failed', err);
    return {
      ok: false,
      error: 'That change could not be saved. Nothing was changed.',
    };
  }
  if (!written.ok) return { ok: false, error: written.error };

  // Best-effort, and it only ever follows the confirmed write above.
  await logCaseEvent({
    caseId: owned.exhibit.caseId,
    eventType: 'exhibit_details_updated',
    metadata: { label: owned.exhibit.label },
  });

  revalidatePath(`/cases/${owned.exhibit.caseId}`);
  return { ok: true };
}

/**
 * Withdraw an exhibit from the packet, or put it back.
 *
 * `withdrawn` is passed rather than toggled from what is currently stored,
 * because a toggle read from a page the person loaded some time ago can act on
 * a stale value and silently do the opposite of what they pressed.
 *
 * Nothing is deleted. See lib/exhibit-withdrawal.ts for why a delete is the
 * wrong answer here: labels are handed out by position, so removing Exhibit K
 * makes every document that already cites K cite a different exhibit.
 */
export async function setExhibitWithdrawnAction(
  exhibitId: string,
  withdrawn: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const owned = await loadOwnedExhibit(exhibitId);
  if (!owned.ok) return { ok: false, error: owned.error };

  let written;
  try {
    written = await setExhibitWithdrawn({ exhibitId, withdrawn: withdrawn === true });
  } catch (err) {
    console.error('[setExhibitWithdrawnAction] failed', err);
    return {
      ok: false,
      error: withdrawn
        ? 'That exhibit was not withdrawn. Nothing was changed.'
        : 'That exhibit was not put back. Nothing was changed.',
    };
  }
  if (!written.ok) return { ok: false, error: written.error };

  await logCaseEvent({
    caseId: owned.exhibit.caseId,
    eventType: withdrawn ? 'exhibit_withdrawn' : 'exhibit_restored',
    metadata: { label: owned.exhibit.label },
  });

  revalidatePath(`/cases/${owned.exhibit.caseId}`);
  return { ok: true };
}

/**
 * Store a transcript the CASE OWNER typed or pasted in themselves.
 *
 * WHY THIS EXISTS RATHER THAN AUTOMATIC TRANSCRIPTION. Sending the recording
 * to a transcription service is gated off and staying off, because it would
 * put the whole of a client's evidence in front of a third party Advottic
 * holds no DPA and no BAA with (lib/subprocessor-gate.ts). Nothing here reads
 * that gate, touches it, or sends a single byte anywhere: the person
 * transcribes the recording on their own machine and this is where the text
 * lands so that the review, the packet and the exhibit row can use it.
 *
 * IT IS STORED AS SCAN DATA, NOT AS THE DESCRIPTION. The description is capped
 * at MAX_EXHIBIT_DESCRIPTION (2,000 characters) and a five minute recording is
 * already twice that. exhibits.scan_data is jsonb and is where the automatic
 * path put its transcript, so every consumer that already reads a transcript
 * reads this one too.
 *
 * AND IT IS MARKED AS A PERSON'S. lib/manual-transcript.ts sets modelUsed,
 * readMethod and the lead sentence of the summary so that no surface can show
 * one person's reading of a recording as a tool's output. That is the point of
 * the feature, not a detail of it.
 *
 * PUBLIC HTTP ENDPOINT, like every server action. Authorization is here, not
 * on the page: loadOwnedExhibit resolves the exhibit, resolves the case it
 * belongs to, and confirms the caller owns that case, exactly as the edit and
 * withdraw actions above do. Passing somebody else's exhibit id gets the
 * refusal and no write.
 *
 * Returns its refusals rather than throwing them, for the reason
 * rescanExhibitAction gives: React strips an error's message crossing the
 * Server Action boundary in a production build and the person reads a digest.
 */
export async function saveManualTranscriptAction(
  exhibitId: string,
  transcript: string,
): Promise<{ ok: boolean; error?: string }> {
  const owned = await loadOwnedExhibit(exhibitId);
  if (!owned.ok) return { ok: false, error: owned.error };

  // The same question the automatic Transcribe path asks, answered by the same
  // module rather than by a second copy of the rule. A box to paste a
  // transcript into does not belong on a PDF or a photograph: there is nothing
  // there that was said.
  if (!exhibitIsTranscribable(owned.exhibit)) {
    return {
      ok: false,
      error:
        'A transcript can only be added to an audio or video exhibit. Nothing was changed.',
    };
  }

  // Refuses an empty box and refuses anything past the cap. It never truncates
  // and never rewrites the text. See lib/manual-transcript.ts for why an empty
  // box is a refusal and not a delete.
  const checked = checkManualTranscript(transcript);
  if (!checked.ok) return { ok: false, error: checked.error };

  const scan = buildManualTranscriptScan({
    text: checked.text,
    isVideo: exhibitIsVideoRecording(owned.exhibit),
    now: new Date().toISOString(),
  });

  try {
    await saveExhibitScan(exhibitId, scan);
  } catch (err) {
    // saveExhibitScan confirms its own write and throws when no row was
    // touched. Reporting success on a transcript that did not land would send
    // somebody into a hearing believing the text is on the case.
    console.error('[saveManualTranscriptAction] failed', err);
    return {
      ok: false,
      error: 'That transcript could not be saved. Nothing was changed. Please try again.',
    };
  }

  // Best-effort, and only after the confirmed write above.
  //
  // Reuses `exhibit_details_updated` deliberately. audit_events.event_type is
  // a CLOSED check constraint, so a truer event name would need a migration,
  // and this change is meant to need none. The sentence that type renders,
  // "Changed the details on Exhibit K. The file and the label are unchanged",
  // is true of a transcript save.
  await logCaseEvent({
    caseId: owned.exhibit.caseId,
    eventType: 'exhibit_details_updated',
    metadata: { label: owned.exhibit.label, change: 'transcript' },
  });

  revalidatePath(`/cases/${owned.exhibit.caseId}`);
  return { ok: true };
}

/**
 * Invite someone to a case.
 *
 * Returns its refusals rather than throwing them. React strips the message
 * off an error that crosses the Server Action boundary and sends a digest
 * instead, so in a production build a thrown reason reaches the browser as
 * "An error occurred in the Server Components render. The specific message is
 * omitted in production builds to avoid leaking sensitive details." Both call
 * sites render err.message, so every refusal here (including the upgrade
 * prompt, which is the whole point of the tier gate) read as an unexplained
 * server fault. A returned value survives the boundary intact. This is the
 * shape lib/firm-actions.ts inviteMatterCollaboratorAction already uses.
 */
export async function inviteCollaboratorAction(
  caseId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; emailed?: boolean }> {
  await assertAuthIfSupabase();
  // Collaborator sharing is Pro-only (TIER_FEATURES.collaborators) -
  // previously only case ownership was checked here (and in the
  // client-side collaborators panel), so any signed-in owner on any
  // tier could invite collaborators regardless of the feature flag.
  // Trial users get full access, matching every other feature gate.
  let tierRefusal: string | null = null;
  try {
    const state = await getEffectiveTrialState();
    if (!isFullAccessTrial(state)) {
      const sub = await getCurrentSubscription();
      const trial = await currentUserTrialGrant().catch(() => undefined);
      if (!hasFeature(sub, 'collaborators', trial)) {
        // Plain-limit copy: see the note in lib/ai.ts.
        tierRefusal = 'Inviting collaborators is not part of your current plan.';
      }
    }
  } catch {
    // never block on a state/subscription lookup failure
  }
  if (tierRefusal) return { ok: false, error: tierRefusal };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleRaw = String(formData.get('role') ?? 'viewer');
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const validRoles: CollaboratorRole[] = [
    'viewer',
    'editor',
    'attorney',
    'witness',
    'represented',
  ];
  const role: CollaboratorRole = validRoles.includes(roleRaw as CollaboratorRole)
    ? (roleRaw as CollaboratorRole)
    : 'viewer';

  let result: { emailed: boolean };
  try {
    result = await inviteCollaborator({ caseId, email, role });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : 'That invite could not be sent, so nothing has changed. Please try again.',
    };
  }

  await logCaseEvent({
    caseId,
    eventType: 'collaborator_invited',
    metadata: { email, role },
  });
  // Notify the invited user (if they already have an account) that
  // they've been added to the case. Look up their auth user_id by
  // email; if they don't exist yet, the email invitation handles
  // outreach and we'll notify them on first sign-in.
  try {
    const { createAdminSupabase } = await import('./supabase/admin');
    const admin = createAdminSupabase();
    if (admin) {
      const { data } = await admin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      const inviteeId = (data as { id?: string } | null)?.id;
      if (inviteeId) {
        const caseRecord = await getCase(caseId);
        const { createNotification } = await import('./notifications');
        await createNotification({
          userId: inviteeId,
          type: 'case_invited',
          title: 'You were invited to a case',
          body: caseRecord?.title
            ? `Open the case to start collaborating: ${caseRecord.title}`
            : 'Open the case to start collaborating.',
          link: `/cases/${caseId}`,
          caseId,
        });
      }
    }
  } catch {
    /* notification miss is non-blocking */
  }
  revalidatePath(`/cases/${caseId}`);
  return { ok: true, emailed: result.emailed };
}

/**
 * Witness self-edit: a witness invited to a case writes (or updates)
 * their own account of what happened. Validated server-side; the
 * storage helper enforces "you can only edit your own statement".
 */
export async function updateWitnessStatementAction(
  caseId: string,
  collaboratorId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await assertAuthIfSupabase();
  const statement = String(formData.get('statement') ?? '');
  try {
    await updateWitnessStatement({ collaboratorId, statement });
    await logCaseEvent({
      caseId,
      eventType: 'witness_statement_updated',
      metadata: { collaboratorId, length: statement.trim().length },
    });
    revalidatePath(`/cases/${caseId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save your statement.',
    };
  }
}

export async function removeCollaboratorAction(caseId: string, collaboratorId: string) {
  await assertAuthIfSupabase();
  await removeCollaborator(collaboratorId);
  await logCaseEvent({
    caseId,
    eventType: 'collaborator_removed',
    metadata: { collaboratorId },
  });
  revalidatePath(`/cases/${caseId}`);
}

export async function recordConsentAction(formData: FormData) {
  if (!usingSupabase()) throw new Error('Supabase required.');
  const repRaw = String(formData.get('representation') ?? '');
  const valid: RepresentationStatus[] = ['self_represented', 'represented', 'counsel', 'user'];
  if (!valid.includes(repRaw as RepresentationStatus)) {
    throw new Error('Choose how you are representing yourself.');
  }
  const consentBox = formData.get('consent');
  if (!consentBox) {
    throw new Error('You must accept the terms to continue.');
  }
  const displayName = String(formData.get('displayName') ?? '').trim();
  const language = String(formData.get('language') ?? '').trim().slice(0, 8);
  const themeRaw = String(formData.get('theme') ?? '').trim();
  const theme: 'system' | 'light' | 'dark' | null =
    themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'system'
      ? themeRaw
      : null;
  await recordConsent({
    representation: repRaw as RepresentationStatus,
    displayName: displayName || undefined,
  });
  // Language + theme are captured at first sign-in via the consent
  // modal so the account already has both on file once translations
  // roll out and so the user does not have to dig into settings to
  // pick a theme on first launch.
  const profileUpdates: { language?: string; theme?: 'system' | 'light' | 'dark' } = {};
  if (language) profileUpdates.language = language;
  if (theme) profileUpdates.theme = theme;
  if (Object.keys(profileUpdates).length > 0) {
    try {
      await upsertProfile(profileUpdates);
    } catch {
      // best-effort; consent has already been recorded
    }
  }
  // No redirect - the popup modal in the layout dismisses itself and triggers
  // a router.refresh() so the layout re-fetches the (now-consented) profile.
  // /cases is revalidated so its tour-modal trigger picks up the fresh state.
  revalidatePath('/cases');
  revalidatePath('/');
}

export async function markTourCompletedAction() {
  await markTourCompleted();
  revalidatePath('/cases');
}

export async function updateProfileAction(formData: FormData) {
  if (!usingSupabase()) throw new Error('Profile editing requires Supabase to be configured.');
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');

  const displayName = String(formData.get('displayName') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim();
  const organization = String(formData.get('organization') ?? '').trim();

  await upsertProfile({
    displayName: displayName || null,
    role: role || null,
    organization: organization || null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  });
  revalidatePath('/profile');
  // The firm-side account page renders the same form under the counsel
  // shell, so it needs the same invalidation or a saved name keeps
  // showing the old value there.
  revalidatePath('/counsel/profile');
  revalidatePath('/');
}

/**
 * Set (or clear) the Safe Witness configuration - the contact
 * email, an optional PIN the contact knows you'd include in any
 * genuine alert, and an optional message that opens the alert
 * email body. All three are stored on `profiles`; an empty
 * contact_email disables the feature regardless of PIN / message.
 */
export async function updateSafeWitnessConfigAction(
  formData: FormData,
): Promise<
  | { ok: true; email: string | null; pin: string | null; message: string | null }
  | { ok: false; error: string }
> {
  if (!usingSupabase()) return { ok: false, error: 'Supabase is not configured.' };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const emailRaw = String(formData.get('safeContactEmail') ?? '').trim();
  const email = emailRaw.length === 0 ? null : emailRaw.toLowerCase();
  if (email !== null) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    if (email.length > 254) {
      return { ok: false, error: 'Email is too long.' };
    }
  }

  const pinRaw = String(formData.get('safeWitnessPin') ?? '').trim();
  const pin = pinRaw.length === 0 ? null : pinRaw;
  if (pin !== null && pin.length > 64) {
    return { ok: false, error: 'PIN is too long (64 chars max).' };
  }

  const messageRaw = String(formData.get('safeWitnessMessage') ?? '').trim();
  const message = messageRaw.length === 0 ? null : messageRaw;
  if (message !== null && message.length > 500) {
    return { ok: false, error: 'Message is too long (500 chars max).' };
  }

  const { createServerSupabase } = await import('./supabase/server');
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({
      safe_contact_email: email,
      safe_witness_pin: pin,
      safe_witness_message: message,
    })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/profile');
  return { ok: true, email, pin, message };
}

/**
 * Back-compat alias for the prior call site that only set the
 * email field. Existing form submissions keep working until they
 * upgrade to the multi-field updater.
 */
export async function updateSafeContactEmailAction(
  formData: FormData,
): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const res = await updateSafeWitnessConfigAction(formData);
  if (!res.ok) return res;
  return { ok: true, email: res.email };
}

/**
 * Multi-contact Safe Witness: add a new contact row. Either email
 * or phone (or both) is required; the DB CHECK enforces this too.
 * Phone is stored in E.164 - we don't try to format it, we reject
 * non-E.164 input so the SMS layer can blindly trust the value.
 */
export async function addSafeWitnessContactAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      contact: {
        id: string;
        display_name: string | null;
        email: string | null;
        phone: string | null;
      };
    }
  | { ok: false; error: string }
> {
  if (!usingSupabase()) return { ok: false, error: 'Supabase is not configured.' };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const name = String(formData.get('displayName') ?? '').trim().slice(0, 80) || null;
  const emailRaw = String(formData.get('email') ?? '').trim();
  const email = emailRaw.length === 0 ? null : emailRaw.toLowerCase();
  if (email !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (email !== null && email.length > 254) {
    return { ok: false, error: 'Email is too long.' };
  }
  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const phone = phoneRaw.length === 0 ? null : phoneRaw;
  if (phone !== null) {
    // E.164: + followed by 1-15 digits, first digit 1-9.
    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      return {
        ok: false,
        error:
          'Phone must be in international format starting with +, e.g. +14155551234',
      };
    }
  }
  if (email === null && phone === null) {
    return { ok: false, error: 'Add an email, a phone, or both.' };
  }

  // Use the admin client to insert the contact. We still trust the
  // user-context getCurrentUser() check above for auth (the action
  // refuses without a signed-in user), but we bypass RLS for the
  // actual write + readback. This avoids the silent-fail mode we hit
  // earlier where:
  //   - the user-context client's cookies were stale,
  //   - auth.uid() at the Postgres level came back null,
  //   - the INSERT silently dropped (WITH CHECK failed without
  //     raising in the postgrest path), and
  //   - .maybeSingle() returned null with no error, so the action
  //     happily returned { ok: true, contact: null } and the contact
  //     never appeared in the list.
  // The admin client always succeeds the insert + readback when the
  // row is valid, so any failure now produces a real error message.
  const { createAdminSupabase } = await import('./supabase/admin');
  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, error: 'Server misconfigured (admin client).' };
  }
  const { data, error } = await admin
    .from('safe_witness_contacts')
    .insert({
      user_id: user.id,
      display_name: name,
      email,
      phone,
    })
    .select('id, display_name, email, phone')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) {
    // Defense in depth: a null row after a successful insert should
    // never happen with the admin client, but if Postgres ever does
    // return zero rows for this insert we want a loud failure rather
    // than the previous silent UI add-then-disappear loop.
    return {
      ok: false,
      error:
        'Contact insert returned no row. Refresh and try again, or contact support if this keeps happening.',
    };
  }
  revalidatePath('/profile');
  return {
    ok: true,
    contact: data as {
      id: string;
      display_name: string | null;
      email: string | null;
      phone: string | null;
    },
  };
}

/**
 * Save the user's own phone number to profiles.phone. Used by the
 * Safe Witness alert email's "Call user" button so a contact can
 * dial the user with one tap. Empty value clears the column,
 * which removes the button from future alerts.
 */
export async function updateUserPhoneAction(
  formData: FormData,
): Promise<
  | { ok: true; phone: string | null; firstName: string | null }
  | { ok: false; error: string }
> {
  if (!usingSupabase()) return { ok: false, error: 'Supabase is not configured.' };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  // Phone validation (E.164: + then country code then number).
  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const phone = phoneRaw.length === 0 ? null : phoneRaw;
  if (phone !== null && !/^\+[1-9]\d{1,14}$/.test(phone)) {
    return {
      ok: false,
      error:
        'Phone must be in international format starting with +, e.g. +14155551234',
    };
  }

  // First name: short personal label used in Safe Witness alerts
  // ("Call Abel" instead of "Call Advottic LLC"). Trimmed + capped at
  // 40 chars; empty string clears the column (null) so the alert
  // route falls back to display_name's first token.
  const firstNameRaw = String(formData.get('firstName') ?? '').trim().slice(0, 40);
  const firstName = firstNameRaw.length === 0 ? null : firstNameRaw;

  const { createServerSupabase } = await import('./supabase/server');
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({ phone, first_name: firstName })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/profile');
  return { ok: true, phone, firstName };
}

export async function deleteSafeWitnessContactAction(
  contactId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!usingSupabase()) return { ok: false, error: 'Supabase is not configured.' };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const { createServerSupabase } = await import('./supabase/server');
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('safe_witness_contacts')
    .delete()
    .eq('id', contactId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/profile');
  return { ok: true };
}

export async function updateHearingAction(
  caseId: string,
  input: { hearingAt: string | null; hearingLocation: string; hearingNotes: string },
) {
  await assertAuthIfSupabase();
  const at = input.hearingAt ? new Date(input.hearingAt).toISOString() : null;
  await updateCaseHearing({
    caseId,
    hearingAt: at,
    hearingLocation: input.hearingLocation.trim() || null,
    hearingNotes: input.hearingNotes.trim() || null,
  });
  await logCaseEvent({
    caseId,
    eventType: 'hearing_updated',
    metadata: { hearingAt: at },
  });
  // Hearing-reminder email to every collaborator on the case (witness,
  // editor, attorney, viewer). Best-effort: failures must not block
  // the hearing save itself. Skipped when the hearing is being
  // cleared (at === null) since there's nothing to remind about.
  if (at) {
    try {
      const { notifyCollaboratorsOfHearing } = await import('./activity');
      await notifyCollaboratorsOfHearing({
        caseId,
        hearingAt: at,
        hearingLocation: input.hearingLocation.trim() || null,
      });
    } catch {
      /* ignore - logged inside the helper */
    }
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
}

/**
 * Permanently delete a case. The action redirects to /cases on success
 * and returns a structured error on failure so the calling client can
 * surface it inline instead of crashing the page.
 */
export async function deleteCaseAction(
  _prevState: { ok: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const caseId = String(formData.get('caseId') ?? '').trim();
  const confirm = String(formData.get('confirm') ?? '').trim();
  try {
    await assertAuthIfSupabase();
    if (!caseId) return { ok: false, error: 'Missing case id.' };
    if (confirm.toLowerCase() !== 'delete') {
      return {
        ok: false,
        error: 'Type "delete" to confirm. This action cannot be undone.',
      };
    }
    await deleteCase(caseId);
  } catch (err) {
    console.error('[deleteCaseAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not delete case.',
    };
  }
  revalidatePath('/cases');
  redirect('/cases');
}

export async function setCaseStatusAction(caseId: string, status: CaseStatus) {
  await assertAuthIfSupabase();
  const valid: CaseStatus[] = [
    'draft',
    'open',
    'under_review',
    'needs_evidence',
    'export_ready',
    'closed',
    'archived',
  ];
  if (!valid.includes(status)) throw new Error('Invalid status.');
  // Read the previous status so the event metadata captures the transition.
  const prev = await getCase(caseId);
  // ORDER IS LOAD-BEARING. updateCaseStatus throws unless a row was actually
  // written, so nothing below it runs for a transition that did not happen.
  // Moving the log above this call, or catching around it, puts
  // `case_status_changed` into the audit chain for a case whose status never
  // moved. On this product that chain is evidence about a legal matter: a
  // reader has no way to tell an entry that describes a real transition from
  // one that describes an attempt, so an entry must only ever follow the write.
  await updateCaseStatus(caseId, status);
  await logCaseEvent({
    caseId,
    eventType: 'case_status_changed',
    metadata: { from: prev?.status ?? null, to: status },
  });
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
}

export async function closeCaseWithSurveyAction(
  caseId: string,
  survey: {
    helpfulRating: number | null;
    outcome: string | null;
    whatWorked: string;
    whatCouldImprove: string;
    mayContact: boolean;
  },
) {
  await assertAuthIfSupabase();
  const validOutcomes: CloseSurveyOutcome[] = [
    'resolved',
    'settled',
    'dropped',
    'ongoing_other_tool',
    'other',
  ];
  const outcome: CloseSurveyOutcome | null =
    survey.outcome && validOutcomes.includes(survey.outcome as CloseSurveyOutcome)
      ? (survey.outcome as CloseSurveyOutcome)
      : null;
  const rating =
    typeof survey.helpfulRating === 'number' &&
    survey.helpfulRating >= 1 &&
    survey.helpfulRating <= 5
      ? survey.helpfulRating
      : null;

  await recordCloseSurvey({
    caseId,
    helpfulRating: rating,
    outcome,
    whatWorked: survey.whatWorked.trim() || null,
    whatCouldImprove: survey.whatCouldImprove.trim() || null,
    mayContact: Boolean(survey.mayContact),
  });
  await updateCaseStatus(caseId, 'closed');
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
}

export async function runReviewAction(caseId: string) {
  await assertAuthIfSupabase();
  const caseRecord = await getCase(caseId);
  if (!caseRecord) {
    throw new Error('Case not found.');
  }
  const exhibits = await listExhibits(caseId);
  const review = await runReview(caseRecord, exhibits);
  await saveReview(review);
  await logCaseEvent({ caseId, eventType: 'review_run' });
  // Notify the case owner that the review finished. Best-effort -
  // a notification miss should not break the review flow. Skip if
  // ownerId isn't populated (file-mode storage path).
  if (caseRecord.ownerId) {
    try {
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: caseRecord.ownerId,
        type: 'case_review_complete',
        title: 'Advottic Review is ready',
        body: `Review complete for "${caseRecord.title}".`,
        link: `/cases/${caseId}`,
        caseId,
      });
    } catch {
      /* notification miss is non-blocking */
    }
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
}

// ---------------------------------------------------------------------------
// Admin actions - guarded by isCurrentUserAdmin so even a direct POST from
// a non-admin gets rejected. Server-side enforcement; never trust the UI.
// ---------------------------------------------------------------------------

export type AdminToggleResult = { ok: boolean; error?: string };

async function assertAdmin(): Promise<void> {
  const ok = await isCurrentUserAdmin();
  if (!ok) throw new Error('Admin access required.');
}

export async function setUserAdminAction(
  userId: string,
  isAdmin: boolean,
): Promise<AdminToggleResult> {
  try {
    await assertAdmin();
    await adminSetUserAdmin({ userId, isAdmin });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (err) {
    console.error('[setUserAdminAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not update admin status.',
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2 white-label: provision / revoke a tenant subdomain for a firm.
// HQ-only. The flow:
//   1. Validate caller is admin.
//   2. Look up the firm row (admin client to bypass RLS).
//   3. Compute hostname = <slug>.advottic.com (slug already unique).
//   4. Call Vercel API to add the domain to the project. The wildcard
//      CNAME at GoDaddy means DNS already resolves; Vercel auto-issues
//      a TLS cert against the configured hostname.
//   5. Flip firms.subdomain_enabled in the DB.
//   6. Invalidate the in-process firm cache so the next request to
//      <slug>.advottic.com lands on the tenant flow within seconds
//      instead of waiting for the 60s TTL.
// All five steps happen inside a single server action so the operator
// gets a clean ok / error response.
// ---------------------------------------------------------------------------

export type SubdomainProvisionResult = {
  ok: boolean;
  error?: string;
  hostname?: string;
};

export async function provisionTenantSubdomainAction(
  firmId: string,
): Promise<SubdomainProvisionResult> {
  try {
    await assertAdmin();
    const { addProjectDomain, isVercelApiConfigured } = await import(
      './vercel'
    );
    if (!isVercelApiConfigured()) {
      return {
        ok: false,
        error:
          'Vercel API is not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID in the Vercel project environment variables and redeploy.',
      };
    }
    const { createAdminSupabase } = await import('./supabase/admin');
    const admin = createAdminSupabase();
    if (!admin) {
      return {
        ok: false,
        error:
          'Service role is not configured on this deployment. Set SUPABASE_SERVICE_ROLE_KEY.',
      };
    }
    const { data: firm, error: readErr } = await admin
      .from('firms')
      .select('slug, subdomain_enabled')
      .eq('id', firmId)
      .maybeSingle();
    if (readErr || !firm) {
      return { ok: false, error: 'Firm not found.' };
    }
    const slug = (firm as { slug: string }).slug;
    if (!slug || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      return {
        ok: false,
        error: `Firm slug "${slug}" is not subdomain-safe. Use lowercase letters, digits, and hyphens.`,
      };
    }
    const hostname = `${slug}.advottic.com`;

    // Vercel first - if registration fails we never write the flag,
    // so the system stays in a consistent state.
    const vercel = await addProjectDomain(hostname);
    if (!vercel.ok) {
      return {
        ok: false,
        error: `Vercel domain registration failed: ${vercel.error}`,
      };
    }

    // Flip the flag.
    const { error: writeErr } = await admin
      .from('firms')
      .update({ subdomain_enabled: true })
      .eq('id', firmId);
    if (writeErr) {
      return {
        ok: false,
        error: `Domain registered with Vercel, but flipping the database flag failed: ${writeErr.message}. Retry the toggle.`,
      };
    }

    // Drop the cache so the next request hits a fresh row.
    const { invalidateFirmSubdomain } = await import('./firm-cache');
    invalidateFirmSubdomain(slug);

    revalidatePath('/admin/firms');
    return { ok: true, hostname };
  } catch (err) {
    console.error('[provisionTenantSubdomainAction] failed', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not provision tenant subdomain.',
    };
  }
}

/**
 * HQ-only: update a firm's brand assets (logo + accent color). Used
 * from the /admin/firms table. The firm logo is uploaded to the
 * public firm-logos Supabase Storage bucket; accent color is a hex
 * string that the counsel layout injects as the --firm-accent CSS
 * variable. After update we invalidate the firm cache so the new
 * branding shows up on <slug>.advottic.com without waiting the 60s
 * TTL.
 */
export type FirmBrandingResult = {
  ok: boolean;
  error?: string;
  logoUrl?: string;
};

export async function updateFirmBrandingAction(
  firmId: string,
  formData: FormData,
): Promise<FirmBrandingResult> {
  try {
    await assertAdmin();
    const { createAdminSupabase } = await import('./supabase/admin');
    const admin = createAdminSupabase();
    if (!admin) {
      return {
        ok: false,
        error:
          'Service role is not configured on this deployment. Set SUPABASE_SERVICE_ROLE_KEY.',
      };
    }

    const { data: firm, error: readErr } = await admin
      .from('firms')
      .select('id, slug, logo_url')
      .eq('id', firmId)
      .maybeSingle();
    if (readErr || !firm) {
      return { ok: false, error: 'Firm not found.' };
    }
    const slug = (firm as { slug: string }).slug;
    const previousLogoUrl = (firm as { logo_url: string | null }).logo_url;

    const accentRaw = (formData.get('accentColor') as string | null)?.trim();
    const accent = accentRaw && /^#[0-9a-fA-F]{6}$/.test(accentRaw) ? accentRaw : null;
    const removeLogo = formData.get('removeLogo') === '1';
    const file = formData.get('logo') as File | null;

    const updates: Record<string, unknown> = {};
    if (accent) updates.accent_color = accent;

    let newLogoUrl: string | null = null;

    if (removeLogo) {
      updates.logo_url = null;
    } else if (file && typeof (file as File).arrayBuffer === 'function' && file.size > 0) {
      // Validate file type + size on the server (never trust client).
      const allowed = new Set([
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
      ]);
      if (!allowed.has(file.type)) {
        return {
          ok: false,
          error: `Logo must be PNG, JPEG, WebP, or SVG (got ${file.type || 'unknown'}).`,
        };
      }
      // 2 MB cap. The header renders the logo at 32-36px so anything
      // bigger is just bloat and slows tenant page loads.
      if (file.size > 2 * 1024 * 1024) {
        return {
          ok: false,
          error: `Logo is too big (${Math.round(file.size / 1024)} KB). Keep it under 2 MB.`,
        };
      }
      const ext =
        file.type === 'image/png' ? 'png'
        : file.type === 'image/jpeg' ? 'jpg'
        : file.type === 'image/webp' ? 'webp'
        : 'svg';
      // Append a cache-busting timestamp so the public URL changes
      // each upload - browsers + Vercel image proxy cache by URL.
      const path = `${slug}/${Date.now()}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: upErr } = await admin.storage
        .from('firm-logos')
        .upload(path, buffer, {
          contentType: file.type,
          upsert: false,
          cacheControl: '31536000',
        });
      if (upErr) {
        return { ok: false, error: `Storage upload failed: ${upErr.message}` };
      }
      const { data: pub } = admin.storage.from('firm-logos').getPublicUrl(path);
      newLogoUrl = pub.publicUrl;
      updates.logo_url = newLogoUrl;
    }

    if (Object.keys(updates).length === 0) {
      return {
        ok: false,
        error: 'No changes - upload a logo, change the accent color, or check Remove logo.',
      };
    }

    const { error: writeErr } = await admin
      .from('firms')
      .update(updates)
      .eq('id', firmId);
    if (writeErr) {
      return { ok: false, error: writeErr.message };
    }

    // Best-effort: delete the previous logo file so we don't pile up
    // orphaned blobs. Non-fatal.
    if ((removeLogo || newLogoUrl) && previousLogoUrl) {
      try {
        const u = new URL(previousLogoUrl);
        // Path under the bucket lives after `/firm-logos/`.
        const marker = '/firm-logos/';
        const idx = u.pathname.indexOf(marker);
        if (idx >= 0) {
          const oldPath = u.pathname.slice(idx + marker.length);
          if (oldPath.startsWith(`${slug}/`)) {
            await admin.storage.from('firm-logos').remove([oldPath]);
          }
        }
      } catch {
        /* best effort */
      }
    }

    // Invalidate the in-process firm cache so the next request to
    // <slug>.advottic.com picks up the new branding immediately.
    const { invalidateFirmSubdomain } = await import('./firm-cache');
    invalidateFirmSubdomain(slug);

    revalidatePath('/admin/firms');
    return { ok: true, logoUrl: newLogoUrl ?? undefined };
  } catch (err) {
    console.error('[updateFirmBrandingAction] failed', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not update firm branding.',
    };
  }
}

/**
 * Disconnect a firm's OAuth integration with a third-party provider
 * (Microsoft 365, Zoom, etc). Soft-revokes - we keep the row for the
 * audit trail of who disconnected and when, but null out the encrypted
 * tokens so they cannot be used. The next /authorize hit by any firm
 * member upserts a fresh connection (revoked_at clears, new tokens
 * land).
 */
export async function disconnectFirmIntegrationAction(
  firmId: string,
  provider: 'microsoft' | 'zoom',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Sign in first.' };
    const supabase = createServerSupabase();
    // Owner/admin gate via RLS on firm_integrations + an explicit role
    // check so non-admins get a friendlier error than the generic
    // "no rows updated."
    const { data: member } = await supabase
      .from('firm_members')
      .select('role')
      .eq('firm_id', firmId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) {
      return { ok: false, error: 'You are not a member of that firm.' };
    }
    const role = (member as { role: string }).role;
    if (!['owner', 'admin'].includes(role)) {
      return {
        ok: false,
        error: 'Only firm owners or admins can disconnect integrations.',
      };
    }
    const { createAdminSupabase } = await import('./supabase/admin');
    const admin = createAdminSupabase();
    if (!admin) {
      return {
        ok: false,
        error: 'Service role is not configured on this deployment.',
      };
    }
    const { error: updateErr } = await admin
      .from('firm_integrations')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: user.id,
      })
      .eq('firm_id', firmId)
      .eq('provider', provider);
    if (updateErr) {
      return { ok: false, error: updateErr.message };
    }
    // /counsel/meetings is now a redirect shim to /counsel/calendar
    // (Meetings + Calendar merged). Revalidate the new home so the
    // connectors panel re-renders with the disconnected state.
    revalidatePath('/counsel/calendar');
    revalidatePath('/counsel/meetings');
    return { ok: true };
  } catch (err) {
    console.error('[disconnectFirmIntegrationAction] failed', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not disconnect integration.',
    };
  }
}

export async function revokeTenantSubdomainAction(
  firmId: string,
): Promise<SubdomainProvisionResult> {
  try {
    await assertAdmin();
    const { removeProjectDomain, isVercelApiConfigured } = await import(
      './vercel'
    );
    const { createAdminSupabase } = await import('./supabase/admin');
    const admin = createAdminSupabase();
    if (!admin) {
      return {
        ok: false,
        error:
          'Service role is not configured on this deployment. Set SUPABASE_SERVICE_ROLE_KEY.',
      };
    }
    const { data: firm, error: readErr } = await admin
      .from('firms')
      .select('slug')
      .eq('id', firmId)
      .maybeSingle();
    if (readErr || !firm) {
      return { ok: false, error: 'Firm not found.' };
    }
    const slug = (firm as { slug: string }).slug;
    const hostname = `${slug}.advottic.com`;

    // Flip the flag FIRST when revoking. The middleware tenant
    // resolver checks subdomain_enabled, so flipping first stops new
    // requests from being routed as tenant traffic immediately even
    // if the Vercel detach takes a moment.
    const { error: writeErr } = await admin
      .from('firms')
      .update({ subdomain_enabled: false })
      .eq('id', firmId);
    if (writeErr) {
      return {
        ok: false,
        error: `Disabling the subdomain flag failed: ${writeErr.message}.`,
      };
    }

    const { invalidateFirmSubdomain } = await import('./firm-cache');
    invalidateFirmSubdomain(slug);

    // Vercel detach is best-effort. If it fails the flag is already
    // off, so the subdomain serves 404 from middleware anyway. Surface
    // the error so the operator knows to clean up the Vercel side.
    if (isVercelApiConfigured()) {
      const vercel = await removeProjectDomain(hostname);
      if (!vercel.ok) {
        return {
          ok: false,
          error: `Subdomain disabled in DB, but Vercel detach failed: ${vercel.error}. Remove the domain manually in the Vercel dashboard.`,
          hostname,
        };
      }
    }

    revalidatePath('/admin/firms');
    return { ok: true, hostname };
  } catch (err) {
    console.error('[revokeTenantSubdomainAction] failed', err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not revoke tenant subdomain.',
    };
  }
}

// ---------------------------------------------------------------------------
// User preferences (theme + language). Light wrappers around upsertProfile
// so client components can persist via a single round-trip.
// ---------------------------------------------------------------------------

export type PrefResult = { ok: boolean; error?: string };

export async function setThemeAction(
  theme: 'light' | 'dark' | 'system',
): Promise<PrefResult> {
  try {
    if (!['light', 'dark', 'system'].includes(theme)) {
      return { ok: false, error: 'Invalid theme.' };
    }
    if (!usingSupabase()) return { ok: true }; // local mode: noop, client cache only
    const user = await getCurrentUser();
    if (!user) return { ok: true }; // unauthed: client cache only
    await upsertProfile({ theme });
    revalidatePath('/profile');
    return { ok: true };
  } catch (err) {
    console.error('[setThemeAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save theme.',
    };
  }
}

export async function setLanguageAction(language: string): Promise<PrefResult> {
  try {
    const trimmed = language.trim().slice(0, 8);
    if (!usingSupabase()) return { ok: true };
    const user = await getCurrentUser();
    if (!user) return { ok: true };
    await upsertProfile({ language: trimmed || null });
    revalidatePath('/profile');
    return { ok: true };
  } catch (err) {
    console.error('[setLanguageAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save language.',
    };
  }
}

/**
 * Fire-and-forget view tracking. The case detail server component
 * calls this on render. The cooldown logic in lib/activity.ts means
 * the owner is emailed at most once every 4 hours per (case, viewer).
 */
export async function trackCaseViewAction(caseId: string): Promise<void> {
  try {
    await assertAuthIfSupabase();
    if (!caseId) return;
    await logCaseEvent({ caseId, eventType: 'case_viewed' });
  } catch (err) {
    console.error('[trackCaseViewAction] failed', err);
  }
}

// ---------------------------------------------------------------------------
// Feedback - bug reports / suggestions submitted from /feedback. Admins
// triage from /admin/feedback.
// ---------------------------------------------------------------------------

export type SubmitFeedbackResult = { ok: boolean; error?: string; id?: string };

export async function submitFeedbackAction(
  _prevState: SubmitFeedbackResult | null,
  formData: FormData,
): Promise<SubmitFeedbackResult> {
  try {
    await assertAuthIfSupabase();
    const validCategories: FeedbackCategory[] = ['bug', 'suggestion', 'praise', 'other'];
    const categoryRaw = String(formData.get('category') ?? 'suggestion');
    const category: FeedbackCategory = validCategories.includes(
      categoryRaw as FeedbackCategory,
    )
      ? (categoryRaw as FeedbackCategory)
      : 'suggestion';
    const subject = String(formData.get('subject') ?? '').trim();
    const body = String(formData.get('body') ?? '').trim();
    const urlAtSubmit = String(formData.get('urlAtSubmit') ?? '').trim() || null;
    const userAgent = String(formData.get('userAgent') ?? '').trim() || null;
    if (!subject) {
      return { ok: false, error: 'A short subject is required.' };
    }
    if (body.length < 10) {
      return {
        ok: false,
        error: 'Tell us a little more so we can help (at least 10 characters).',
      };
    }
    const created = await createFeedback({
      category,
      subject: subject.slice(0, 200),
      body: body.slice(0, 4000),
      urlAtSubmit: urlAtSubmit ? urlAtSubmit.slice(0, 500) : null,
      userAgent: userAgent ? userAgent.slice(0, 500) : null,
    });
    revalidatePath('/feedback');
    // The firm-side feedback page renders the same form and the same
    // "your previous feedback" history, so it needs the same
    // invalidation or a submission the firm just sent is missing from
    // the list directly below the form.
    revalidatePath('/counsel/feedback');
    revalidatePath('/admin/feedback');
    return { ok: true, id: created.id };
  } catch (err) {
    console.error('[submitFeedbackAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not submit feedback.',
    };
  }
}

export async function setFeedbackStatusAction(
  id: string,
  status: FeedbackStatus,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertAdmin();
    const valid: FeedbackStatus[] = ['new', 'triaged', 'resolved', 'wontfix'];
    if (!valid.includes(status)) {
      return { ok: false, error: 'Invalid status.' };
    }
    await adminUpdateFeedback({ id, status });
    revalidatePath('/admin/feedback');
    return { ok: true };
  } catch (err) {
    console.error('[setFeedbackStatusAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not update feedback.',
    };
  }
}

export async function updateFeedbackNotesAction(
  id: string,
  adminNotes: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertAdmin();
    await adminUpdateFeedback({ id, adminNotes: adminNotes.trim().slice(0, 4000) || null });
    revalidatePath('/admin/feedback');
    return { ok: true };
  } catch (err) {
    console.error('[updateFeedbackNotesAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save notes.',
    };
  }
}

export async function setUserBlockedAction(
  userId: string,
  isBlocked: boolean,
): Promise<AdminToggleResult> {
  try {
    await assertAdmin();
    await adminSetUserBlocked({ userId, isBlocked });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (err) {
    console.error('[setUserBlockedAction] failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not update account status.',
    };
  }
}

/**
 * Mark a single notification read for the current user. Best-effort.
 */
export async function markNotificationReadAction(id: string): Promise<void> {
  const { markNotificationRead } = await import('./notifications');
  await markNotificationRead(id);
  revalidatePath('/');
}

/**
 * Mark every unread notification read for the current user.
 */
export async function markAllNotificationsReadAction(): Promise<void> {
  const { markAllNotificationsRead } = await import('./notifications');
  await markAllNotificationsRead();
  revalidatePath('/');
}

/**
 * Delete a single notification from the current user's inbox.
 */
export async function deleteNotificationAction(id: string): Promise<void> {
  const { deleteNotification } = await import('./notifications');
  await deleteNotification(id);
  revalidatePath('/');
}

/**
 * Update an enterprise inquiry from the admin dashboard. Status +
 * admin notes only - the rest of the row (contact, message, etc.)
 * is what the firm submitted and should not be edited.
 *
 * Admin-gated. Returns nothing on success; throws on auth failure
 * or DB error so the client can show inline.
 */
export async function updateEnterpriseInquiryAction(input: {
  id: string;
  status: string;
  adminNotes?: string;
}): Promise<void> {
  await assertAdmin();
  const validStatuses = [
    'new',
    'contacted',
    'demo-scheduled',
    'pilot',
    'signed',
    'closed-lost',
    'archived',
  ];
  if (!validStatuses.includes(input.status)) {
    throw new Error('Invalid status.');
  }
  const notes = (input.adminNotes ?? '').slice(0, 4000);
  const { createAdminSupabase } = await import('./supabase/admin');
  const admin = createAdminSupabase();
  if (!admin) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured.');
  const { error } = await admin
    .from('enterprise_inquiries')
    .update({
      status: input.status,
      admin_notes: notes || null,
    })
    .eq('id', input.id);
  if (error) {
    console.error('[updateEnterpriseInquiryAction] failed', error);
    throw new Error('Could not update inquiry.');
  }
  revalidatePath('/admin/enterprise-inquiries');
}

/**
 * Record (or refresh) the device fingerprint for the current user.
 * Used to deter the "make a new email to get a fresh 7-day trial on
 * the same device" abuse pattern.
 *
 * The first time a device_id is seen, we INSERT with first_seen_at
 * = now and the current user as latest_user_id. Subsequent calls
 * (same device, same OR different user) bump signup_count + reset
 * latest_user_id + update last_seen_at. The trial-state computation
 * (in storage.ts) consults this table alongside signup_history and
 * uses the earlier first_seen_at as the trial anchor when they
 * differ - so a fresh email on a previously-seen device starts the
 * trial clock at the device's first_seen_at, not now.
 *
 * Best-effort: any failure is swallowed. Trial enforcement is not a
 * security boundary; it's a friction layer.
 */
export async function recordDeviceFingerprintAction(deviceId: string): Promise<void> {
  if (!usingSupabase()) return;
  if (!deviceId || deviceId.length > 200) return;
  const user = await getCurrentUser();
  if (!user) return;
  const { createAdminSupabase } = await import('./supabase/admin');
  const admin = createAdminSupabase();
  if (!admin) return;
  // Upsert: insert with current user, on conflict (PK = device_id)
  // bump count + last_seen_at + latest_user_id.
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from('device_trial_history')
    .select('signup_count, latest_user_id')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (!existing) {
    await admin.from('device_trial_history').insert({
      device_id: deviceId,
      first_seen_at: now,
      latest_user_id: user.id,
      signup_count: 1,
      last_seen_at: now,
    });
    return;
  }
  const prev = existing as { signup_count: number; latest_user_id: string | null };
  const isNewUser = prev.latest_user_id !== user.id;
  await admin
    .from('device_trial_history')
    .update({
      latest_user_id: user.id,
      signup_count: isNewUser ? prev.signup_count + 1 : prev.signup_count,
      last_seen_at: now,
    })
    .eq('device_id', deviceId);
}

/**
 * Persist an enterprise inquiry submitted from /enterprise. The
 * submission is stored in the `enterprise_inquiries` Supabase table
 * via the service-role client (bypasses RLS - the form is public,
 * by design, and we need to write rows for unauthenticated visitors).
 *
 * The admin team triages new rows from /admin/enterprise-inquiries
 * (TODO: build the dashboard surface), replies by email, and once
 * a deal is signed, sets a custom price in the firm's subscription
 * record so auto-payment runs on the agreed cadence.
 *
 * Throws on validation failure so the client form can show the
 * error inline. Server-side throwing also short-circuits any
 * rate-limit bypass attempts via the action endpoint.
 */
export async function submitEnterpriseInquiryAction(formData: FormData): Promise<void> {
  const firmName = (formData.get('firmName') ?? '').toString().trim();
  const contactName = (formData.get('contactName') ?? '').toString().trim();
  const contactRole = (formData.get('contactRole') ?? '').toString().trim();
  const email = (formData.get('email') ?? '').toString().trim().toLowerCase();
  const sector = (formData.get('sector') ?? '').toString().trim();
  const size = (formData.get('size') ?? '').toString().trim();
  const message = (formData.get('message') ?? '').toString().trim();

  if (!firmName || firmName.length > 200) {
    throw new Error('Please enter a valid firm or organization name.');
  }
  if (!contactName || contactName.length > 120) {
    throw new Error('Please enter your name.');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new Error('Please enter a valid work email address.');
  }
  if (!sector || !['firm', 'inhouse-corp', 'inhouse-other', 'legal-aid', 'government', 'other'].includes(sector)) {
    throw new Error('Please pick a sector.');
  }
  if (size && !['1-3', '4-10', '11-50', '51-200', '200+'].includes(size)) {
    throw new Error('Please pick a team size from the list.');
  }
  if (message.length > 2000) {
    throw new Error('Please keep your message under 2,000 characters.');
  }

  if (!usingSupabase()) {
    // No Supabase configured - log the inquiry for manual follow-up
    // and return success to the user. Acceptable in local-dev / setup
    // mode; admin will see this in their server log.
    console.warn('[submitEnterpriseInquiryAction] Supabase not configured, inquiry logged only', {
      firmName,
      email,
      sector,
    });
    return;
  }

  // Use the admin (service-role) client because the form is public.
  // RLS would otherwise block an anonymous INSERT.
  const { createAdminSupabase } = await import('./supabase/admin');
  const admin = createAdminSupabase();
  if (!admin) {
    // Service-role key isn't wired yet. Fail loudly server-side, but
    // tell the user something soft so they don't think the form is
    // permanently broken.
    console.error('[submitEnterpriseInquiryAction] SUPABASE_SERVICE_ROLE_KEY not set');
    throw new Error('Inquiry could not be saved right now. Please email contact@advottic.com directly.');
  }
  const { error } = await admin.from('enterprise_inquiries').insert({
    firm_name: firmName,
    contact_name: contactName,
    contact_role: contactRole || null,
    email,
    sector,
    team_size: size || null,
    message: message || null,
    status: 'new',
  });
  if (error) {
    console.error('[submitEnterpriseInquiryAction] insert failed', error);
    throw new Error('Could not save your inquiry. Please try again or email contact@advottic.com.');
  }
}

// ---------------------------------------------------------------------------
// Sidebar menu customization
// ---------------------------------------------------------------------------

/**
 * Persist a user's sidebar customization for a given portal. The
 * client passes the freshly-edited preference shape; the server
 * does a partial-merge into profiles.menu_preferences so editing
 * one portal does not clobber another. RLS already constrains the
 * row to the current user; we add a defense-in-depth user_id
 * filter on the update so a stolen row id cannot poison another
 * profile.
 */
export async function saveMenuPreferencesAction(
  portal: MenuPortal,
  next: { hidden: string[]; order: string[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Auth is not configured.' };
  }
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  if (portal !== 'consumer' && portal !== 'counsel' && portal !== 'admin') {
    return { ok: false, error: 'Unknown portal.' };
  }
  // Sanitize inputs: cap lengths and string-only members so a
  // bad client payload can not balloon the jsonb column.
  const hidden = Array.from(
    new Set(
      (Array.isArray(next.hidden) ? next.hidden : [])
        .filter((s) => typeof s === 'string')
        .map((s) => s.slice(0, 256)),
    ),
  ).slice(0, 64);
  const order = Array.from(
    new Set(
      (Array.isArray(next.order) ? next.order : [])
        .filter((s) => typeof s === 'string')
        .map((s) => s.slice(0, 256)),
    ),
  ).slice(0, 64);

  // Partial merge: read current, splice in the new portal block,
  // write back. The Postgres jsonb_set operator could do this in
  // one statement but the round trip is simpler to reason about.
  const { data: row } = await supabase
    .from('profiles')
    .select('menu_preferences')
    .eq('id', user.id)
    .maybeSingle();
  const current =
    ((row as { menu_preferences: Record<string, unknown> | null } | null)
      ?.menu_preferences as Record<string, unknown> | null) ?? {};
  const merged = { ...current, [portal]: { hidden, order } };
  const { error } = await supabase
    .from('profiles')
    .update({ menu_preferences: merged })
    .eq('id', user.id);
  if (error) {
    return { ok: false, error: error.message };
  }
  // Re-render any layout that reads the prefs (the consumer
  // sidebar is rendered by app/layout.tsx).
  revalidatePath('/cases');
  revalidatePath('/');
  return { ok: true };
}


// ---------------------------------------------------------------------------
// The person's own written account of what happened
//
// `cases.description` is that account: the `description` textarea in
// app/cases/new/case-form.tsx is what writes it when the case is created, and
// nothing could change it afterwards until these actions existed.
//
// Every one of them returns its refusal rather than throwing it, for the same
// reason rescanExhibitAction and uploadExhibitAction do: React strips an
// error's message when it crosses the Server Action boundary in a production
// build, so a thrown sentence reaches the person as a digest they cannot act
// on. These sentences were written to be read.
// ---------------------------------------------------------------------------

export type CompositionResult = { ok: boolean; error?: string };

const NOT_YOUR_CASE =
  'Only the person who opened this case can change their account of what happened. ' +
  'Nothing was changed.';

/**
 * Resolve the case and confirm the caller owns it.
 *
 * Every server action is a public HTTP endpoint, so this check lives here and
 * not in the page that decides whether to draw the button. `getCase` is
 * RLS-scoped and `cases` SELECT is membership-wide, so a collaborator or an
 * invited attorney can read this case; only its owner may rewrite the account.
 */
async function loadOwnedCase(
  caseId: string,
  /**
   * What a caller who does not own the case is told. Defaults to the wording
   * for the account of what happened. Passed in rather than hard-coded so the
   * exhibit actions can say what THEY refused, while the ownership rule itself
   * stays in one function and cannot drift between them.
   */
  notOwnerError: string = NOT_YOUR_CASE,
): Promise<
  | { ok: true; caseRecord: import('./types').Case }
  | { ok: false; error: string }
> {
  if (typeof caseId !== 'string' || !caseId.trim()) {
    return { ok: false, error: 'Missing case id.' };
  }
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, error: 'Please sign in again, then make this change.' };
    }
    const caseRecord = await getCase(caseId);
    if (!caseRecord) return { ok: false, error: 'Case not found.' };
    if (caseRecord.ownerId !== user.id) return { ok: false, error: notOwnerError };
    return { ok: true, caseRecord };
  }
  const caseRecord = await getCase(caseId);
  if (!caseRecord) return { ok: false, error: 'Case not found.' };
  return { ok: true, caseRecord };
}

/**
 * Rewrite, or clear, the account of what happened.
 *
 * Passing an empty string is how the account is deleted. That clears the text
 * and nothing else: the case, every exhibit, every collaborator, and every
 * review stay exactly where they are. The prior wording is preserved by
 * updateCaseComposition, which writes the new text and the superseded text in
 * a single update statement.
 */
export async function updateCaseCompositionAction(
  caseId: string,
  text: string,
): Promise<CompositionResult> {
  const owned = await loadOwnedCase(caseId);
  if (!owned.ok) return owned;

  const { MAX_COMPOSITION_LENGTH, normalizeComposition } = await import('./composition');
  const { formatNumber } = await import('./format');
  const next = normalizeComposition(typeof text === 'string' ? text : '');
  if (next.length > MAX_COMPOSITION_LENGTH) {
    return {
      ok: false,
      error:
        `That account is longer than the ${formatNumber(MAX_COMPOSITION_LENGTH)} character limit. ` +
        'Please shorten it, or move the detail into an exhibit. Nothing was changed.',
    };
  }
  if (next === normalizeComposition(owned.caseRecord.description)) {
    // Not an error, and not a write. Recording an edit that changed nothing
    // would put a revision into a legal record that never happened.
    return { ok: true };
  }

  try {
    const { updateCaseComposition } = await import('./storage');
    await updateCaseComposition({ caseId, text: next });
  } catch (err) {
    console.error('[updateCaseCompositionAction] failed', err);
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : 'That change could not be saved. Nothing was changed.',
    };
  }

  // Best-effort. The account itself, and the version it replaced, are already
  // committed above; this entry describes that write and only ever follows it.
  await logCaseEvent({
    caseId,
    eventType: 'case_description_updated',
    metadata: { cleared: next.length === 0 },
  });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
  return { ok: true };
}

/**
 * Clear the account of what happened.
 *
 * Deliberately a separate entry point rather than the caller passing '' to the
 * action above, so that the one destructive thing a person can do to their own
 * words is named in the code the same way it is named in the interface.
 */
export async function clearCaseCompositionAction(
  caseId: string,
): Promise<CompositionResult> {
  return await updateCaseCompositionAction(caseId, '');
}

/**
 * Run the Advottic Review again over the account as it now reads and every
 * exhibit currently on file.
 *
 * Three things this does that runReviewAction above does not.
 *
 * It confirms the caller owns the case before spending anything.
 *
 * It refuses to store a demo. `runReview` returns a placeholder when the
 * deployment has no API key and again when a Pro token balance has run out.
 * That placeholder reads like an analysis. Saved into `ai_reviews` it becomes
 * indistinguishable, on the case page and in an exported packet, from work a
 * model actually did on this matter. Same refusal, and same reason, as the
 * demo check in rescanExhibitAction.
 *
 * It returns its refusal as a value. The person gets the sentence.
 *
 * A run APPENDS: saveReview inserts a new `ai_reviews` row and
 * getLatestReview reads the newest, so the earlier review keeps its own row
 * and its own created_at. Nothing overwrites a review that has already been
 * relied on.
 */
export async function rerunCaseReviewAction(caseId: string): Promise<CompositionResult> {
  const owned = await loadOwnedCase(caseId);
  if (!owned.ok) return owned;
  const caseRecord = owned.caseRecord;

  let review;
  try {
    const exhibits = await listExhibits(caseId);
    review = await runReview(caseRecord, exhibits);
  } catch (err) {
    console.error('[rerunCaseReviewAction] runReview failed', err);
    return { ok: false, error: calmAiMessage(err, AI_UNAVAILABLE_MESSAGE) };
  }

  const { isRealReview } = await import('./composition');
  if (!isRealReview(review)) {
    // Nothing is written. An example template stored here would later be read
    // back as this case's analysis.
    console.error(
      '[rerunCaseReviewAction] refusing to store a placeholder review',
      { caseId, modelUsed: review.modelUsed },
    );
    // A different sentence from the catch above, deliberately. The two
    // causes need opposite fixes (a provider failure versus a placeholder
    // returned in the model's place), and when both said "temporarily
    // unavailable" a person's report could not tell us which one they hit.
    return { ok: false, error: AI_PLACEHOLDER_REFUSED_MESSAGE };
  }

  try {
    await saveReview(review);
  } catch (err) {
    console.error('[rerunCaseReviewAction] saveReview failed', err);
    return {
      ok: false,
      error: 'The review finished but could not be saved. Please try again in a moment.',
    };
  }
  await logCaseEvent({ caseId, eventType: 'review_run' });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
  return { ok: true };
}
