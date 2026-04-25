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
  recordConsent,
  removeCollaborator,
  replaceExhibitPlans,
  saveDefenseAdvice,
  saveReview,
  upsertProfile,
  usingSupabase,
} from './storage';
import { planExhibits, runDefenseAdvice, runReview } from './ai';
import { getCurrentUser } from './supabase/server';
import {
  CASE_TYPES,
  type CaseType,
  type CollaboratorRole,
  type Posture,
  type RepresentationStatus,
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

  const created = await createCase({
    title,
    subjectName,
    subjectType: subject,
    jurisdiction: {
      country,
      state: state || undefined,
      city: city || undefined,
    },
    caseType,
    description,
    posture,
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
  const planItemId = String(formData.get('planItemId') ?? '').trim();

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
    planItemId: planItemId || null,
  });
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases');
}

export async function planExhibitsAction(caseId: string) {
  await assertAuthIfSupabase();
  const caseRecord = await getCase(caseId);
  if (!caseRecord) throw new Error('Case not found.');
  const exhibits = await listExhibits(caseId);
  const items = await planExhibits(caseRecord, exhibits);
  await replaceExhibitPlans(caseId, items);
  revalidatePath(`/cases/${caseId}`);
}

export async function runDefenseAdviceAction(caseId: string) {
  await assertAuthIfSupabase();
  const caseRecord = await getCase(caseId);
  if (!caseRecord) throw new Error('Case not found.');
  const exhibits = await listExhibits(caseId);
  const advice = await runDefenseAdvice(caseRecord, exhibits);
  await saveDefenseAdvice(advice);
  revalidatePath(`/cases/${caseId}`);
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
  await inviteCollaborator({ caseId, email, role });
  revalidatePath(`/cases/${caseId}`);
}

export async function removeCollaboratorAction(caseId: string, collaboratorId: string) {
  await assertAuthIfSupabase();
  await removeCollaborator(collaboratorId);
  revalidatePath(`/cases/${caseId}`);
}

export async function recordConsentAction(formData: FormData) {
  if (!usingSupabase()) throw new Error('Supabase required.');
  const repRaw = String(formData.get('representation') ?? '');
  const valid: RepresentationStatus[] = ['pro_se', 'represented', 'counsel'];
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
