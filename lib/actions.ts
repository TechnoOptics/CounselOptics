'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  addExhibit,
  createCase,
  getCase,
  inviteCollaborator,
  listExhibits,
  markTourCompleted,
  recordCloseSurvey,
  recordConsent,
  removeCollaborator,
  saveReview,
  updateCaseHearing,
  updateCaseStatus,
  upsertProfile,
  usingSupabase,
  type CloseSurveyOutcome,
} from './storage';
import { runReview } from './ai';
import { getCurrentUser } from './supabase/server';
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

export async function createCaseAction(formData: FormData) {
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
    throw new Error('Title, subject name, and country are required.');
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
  // the user's local TZ and convert via Date.parse.
  const hearingRaw = String(formData.get('hearingAt') ?? '').trim();
  const hearingAt = hearingRaw ? new Date(hearingRaw).toISOString() : null;
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

  revalidatePath('/cases');
  redirect(`/cases/${created.id}`);
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

  await addExhibit({
    caseId,
    file,
    description,
    incidentDate: incidentDateRaw || null,
    source: source || null,
    category: category || null,
  });
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
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
  await recordConsent({
    representation: repRaw as RepresentationStatus,
    displayName: displayName || undefined,
  });
  redirect('/cases?welcome=1');
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
