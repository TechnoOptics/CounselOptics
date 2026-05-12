'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  addExhibit,
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
  updateCaseHearing,
  updateCaseStatus,
  updateWitnessStatement,
  upsertProfile,
  usingSupabase,
  type CloseSurveyOutcome,
  type FeedbackCategory,
  type FeedbackStatus,
} from './storage';
import { classifyCaseType, runReview, scanDocument, transcribeMedia } from './ai';
import { createServerSupabase, getCurrentUser, isCurrentUserAdmin, isSupabaseConfigured } from './supabase/server';
import { logCaseEvent } from './activity';
import type { MenuPortal } from './menu-prefs';
import {
  CASE_TYPES,
  type CaseStatus,
  type CaseType,
  type CollaboratorRole,
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
    try {
      const state = await getEffectiveTrialState();
      if (state.mode === 'expired') {
        return {
          ok: false,
          error:
            'Your free trial has ended. Open /billing to subscribe, then create your case.',
        };
      }
    } catch {
      // never block creation on a state-lookup failure
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
  revalidatePath('/cases');
  redirect('/cases');
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

export async function uploadExhibitAction(caseId: string, formData: FormData) {
  await assertAuthIfSupabase();
  const file = formData.get('file');
  const description = String(formData.get('description') ?? '').trim();
  const incidentDateRaw = String(formData.get('incidentDate') ?? '').trim();
  const source = String(formData.get('source') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();

  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Please choose a file to upload.');
  }

  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new Error('File is larger than the 50MB limit.');
  }

  const exhibit = await addExhibit({
    caseId,
    file,
    description,
    incidentDate: incidentDateRaw || null,
    source: source || null,
    category: category || null,
  });

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
}

export async function rescanExhibitAction(exhibitId: string) {
  await assertAuthIfSupabase();
  const exhibit = await getExhibitById(exhibitId);
  if (!exhibit) throw new Error('Exhibit not found.');
  const buf = await getExhibitFileBuffer(exhibit);
  if (!buf) throw new Error('Could not read the underlying file.');
  const scan = await scanDocument({
    fileBuffer: buf,
    mediaType: exhibit.fileType || 'application/octet-stream',
    fileName: exhibit.fileName,
  });
  await saveExhibitScan(exhibitId, scan);
  revalidatePath(`/cases/${exhibit.caseId}`);
}

export async function transcribeExhibitAction(exhibitId: string) {
  await assertAuthIfSupabase();
  const exhibit = await getExhibitById(exhibitId);
  if (!exhibit) throw new Error('Exhibit not found.');
  const ct = (exhibit.fileType || '').toLowerCase();
  if (!ct.startsWith('audio/') && !ct.startsWith('video/')) {
    throw new Error('Only audio or video files can be transcribed.');
  }
  const buf = await getExhibitFileBuffer(exhibit);
  if (!buf) throw new Error('Could not read the underlying file.');
  const scan = await transcribeMedia({
    fileBuffer: buf,
    mediaType: ct,
    fileName: exhibit.fileName,
  });
  await saveExhibitScan(exhibitId, scan);
  revalidatePath(`/cases/${exhibit.caseId}`);
}

export async function inviteCollaboratorAction(caseId: string, formData: FormData) {
  await assertAuthIfSupabase();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleRaw = String(formData.get('role') ?? 'viewer');
  if (!email || !email.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  const validRoles: CollaboratorRole[] = ['viewer', 'editor', 'attorney', 'witness'];
  const role: CollaboratorRole = validRoles.includes(roleRaw as CollaboratorRole)
    ? (roleRaw as CollaboratorRole)
    : 'viewer';
  const result = await inviteCollaborator({ caseId, email, role });
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
  return { emailed: result.emailed };
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
  revalidatePath('/');
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

