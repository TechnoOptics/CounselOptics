'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  addExhibit,
  adminSetUserAdmin,
  adminSetUserBlocked,
  createCase,
  deleteCase,
  getCase,
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
  upsertProfile,
  usingSupabase,
  type CloseSurveyOutcome,
} from './storage';
import { runReview, scanDocument, transcribeMedia } from './ai';
import { getCurrentUser, isCurrentUserAdmin } from './supabase/server';
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

export type CreateCaseResult = { ok: boolean; error?: string };

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

  // Redirect outside the try/catch so the NEXT_REDIRECT control-flow
  // exception isn't swallowed.
  revalidatePath('/cases');
  redirect(`/cases/${createdId}`);
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
  const validRoles: CollaboratorRole[] = ['viewer', 'editor', 'attorney'];
  const role: CollaboratorRole = validRoles.includes(roleRaw as CollaboratorRole)
    ? (roleRaw as CollaboratorRole)
    : 'viewer';
  const result = await inviteCollaborator({ caseId, email, role });
  revalidatePath(`/cases/${caseId}`);
  return { emailed: result.emailed };
}

export async function removeCollaboratorAction(caseId: string, collaboratorId: string) {
  await assertAuthIfSupabase();
  await removeCollaborator(collaboratorId);
  revalidatePath(`/cases/${caseId}`);
}

export async function recordConsentAction(formData: FormData) {
  if (!usingSupabase()) throw new Error('Supabase required.');
  const repRaw = String(formData.get('representation') ?? '');
  const valid: RepresentationStatus[] = ['self_represented', 'represented', 'counsel'];
  if (!valid.includes(repRaw as RepresentationStatus)) {
    throw new Error('Choose how you are representing yourself.');
  }
  const consentBox = formData.get('consent');
  if (!consentBox) {
    throw new Error('You must accept the terms to continue.');
  }
  const displayName = String(formData.get('displayName') ?? '').trim();
  const language = String(formData.get('language') ?? '').trim().slice(0, 8);
  await recordConsent({
    representation: repRaw as RepresentationStatus,
    displayName: displayName || undefined,
  });
  // Language is captured at first sign-in via the consent modal so the
  // account already has a locale on file once translations roll out.
  if (language) {
    try {
      await upsertProfile({ language });
    } catch {
      // language save is non-blocking; consent already recorded
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
  await updateCaseStatus(caseId, status);
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
