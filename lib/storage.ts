import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AIReview,
  Case,
  CaseStatus,
  CaseType,
  Collaborator,
  CollaboratorRole,
  Exhibit,
  Jurisdiction,
  Posture,
  Profile,
  RepresentationStatus,
  ScanData,
  SubjectProfile,
  Subscription,
  SubscriptionStatus,
  SubjectType,
  Tier,
} from './types';
import {
  appendCompositionVersion,
  normalizeComposition,
  parseCompositionHistory,
} from './composition';
import { createServerSupabase, getCurrentUser, isSupabaseConfigured } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { sendEmail, buildInviteEmailHtml, buildCounselWelcomeEmailHtml } from './email';
import { parseMenuPreferences, type AllMenuPreferences } from './menu-prefs';
import { COMP_ULTRA_PRICE_ID } from './personal-tiers';
import {
  summarizeOpenCrashes,
  type OpenCrashSummary,
} from './hq-metrics';

/** Newest unacknowledged reports read to classify known browser noise. */
const OPEN_CRASH_SAMPLE = 500;

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const EXHIBITS_BUCKET = 'exhibits';

type DB = {
  cases: Case[];
  exhibits: Exhibit[];
  aiReviews: AIReview[];
};

// ---------------------------------------------------------------------------
// Mode detection. Supabase mode is used when configured; otherwise, local JSON.
// ---------------------------------------------------------------------------

export function usingSupabase(): boolean {
  return isSupabaseConfigured();
}

// ---------------------------------------------------------------------------
// Shared types for row shape
// ---------------------------------------------------------------------------

type CaseRow = {
  id: string;
  user_id: string;
  title: string;
  subject_name: string;
  subject_type: SubjectType;
  subject_profile: SubjectProfile | null;
  jurisdiction_country: string;
  jurisdiction_state: string | null;
  jurisdiction_city: string | null;
  case_type: string;
  description: string | null;
  // Absent, not null, on a deployment where
  // supabase/migrations/20260822_case_description_history.sql has not run.
  description_history?: unknown;
  posture: Posture | null;
  status: CaseStatus;
  hearing_at: string | null;
  hearing_location: string | null;
  hearing_notes: string | null;
  created_at: string;
  updated_at: string;
};

type ExhibitRow = {
  id: string;
  case_id: string;
  user_id: string;
  label: string;
  file_name: string;
  storage_path: string;
  file_type: string;
  file_size: number;
  description: string | null;
  incident_date: string | null;
  source: string | null;
  category: string | null;
  scan_data: ScanData | null;
  uploaded_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  role: string | null;
  organization: string | null;
  avatar_url: string | null;
  is_admin: boolean | null;
  is_blocked: boolean | null;
  representation: RepresentationStatus | null;
  consented_at: string | null;
  tour_completed_at: string | null;
  theme: 'light' | 'dark' | 'system' | null;
  language: string | null;
  phone_number: string | null;
  phone_verified_at: string | null;
  updated_at: string;
};

type AIReviewRow = {
  id: string;
  case_id: string;
  user_id: string;
  jurisdiction: string | null;
  summary: string | null;
  timeline: string[];
  key_facts: string[];
  possible_issues: string[];
  classification: string | null;
  applicable_legal_references: string[];
  evidence_mapping: string[];
  evidence_to_strengthen: string[];
  subpoena_targets: string[];
  missing_information: string[];
  suggested_next_steps: string[];
  questions_for_attorney: string[];
  disclaimer: string | null;
  model_used: string | null;
  is_demo: boolean;
  created_at: string;
};

function caseFromRow(r: CaseRow): Case {
  return {
    id: r.id,
    ownerId: r.user_id,
    title: r.title,
    subjectName: r.subject_name,
    subjectType: r.subject_type,
    subjectProfile: (r.subject_profile && typeof r.subject_profile === 'object'
      ? r.subject_profile
      : {}) as SubjectProfile,
    jurisdiction: {
      country: r.jurisdiction_country,
      state: r.jurisdiction_state ?? undefined,
      city: r.jurisdiction_city ?? undefined,
    },
    caseType: r.case_type as CaseType,
    description: r.description ?? '',
    descriptionHistory: parseCompositionHistory(r.description_history),
    posture: (r.posture as Posture) ?? 'claimant',
    status: r.status,
    hearingAt: r.hearing_at ?? null,
    hearingLocation: r.hearing_location ?? null,
    hearingNotes: r.hearing_notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function exhibitFromRow(r: ExhibitRow): Exhibit {
  return {
    id: r.id,
    caseId: r.case_id,
    label: r.label,
    fileName: r.file_name,
    storedFileName: r.storage_path,
    fileType: r.file_type,
    fileSize: r.file_size,
    description: r.description ?? '',
    incidentDate: r.incident_date ?? null,
    source: r.source ?? null,
    category: r.category ?? null,
    scanData: r.scan_data ?? null,
    uploadedAt: r.uploaded_at,
  };
}

/**
 * WHY EVERY UPDATE BELOW THAT MATTERS ENDS IN `.select(...)`.
 *
 * postgrest-js resolves with `{ error }` instead of throwing, and an UPDATE
 * that matches ZERO rows is not an error at all: `error` is null and there is
 * nothing else in the response to look at. So `if (error) throw error` on its
 * own cannot tell "the row was written" from "RLS filtered the row out and
 * nothing happened". Both come back clean.
 *
 * That is not hypothetical here. It is how a month of this product's security
 * audit writes were silently dropped, and it is how a case status change that
 * never happened came to be recorded in the audit chain as though it had.
 *
 * Asking for the affected rows back is what closes it: `.select('id')` returns
 * one row when the write landed and an empty array when it did not, so the
 * function can say which. Where a caller then writes to an audit chain or a
 * ledger, that confirmation is the precondition for the entry, never the other
 * way round.
 *
 * Not every update needs it, and the ones that do not are marked at the call
 * site with the reason. The test is what a silent no-op would make the product
 * SAY: if it would report success, or put a claim in a record that is relied on
 * later, confirm the row. If it would merely leave a field stale until the next
 * read corrects it, do not.
 */

/** What a person is told when a write we asked for turned out not to land. */
const NOT_WRITTEN =
  'That change could not be saved. The record may have been removed, or your access to it may have ended.';

export async function saveExhibitScan(exhibitId: string, scan: ScanData): Promise<void> {
  if (usingSupabase()) {
    const supabase = createServerSupabase();
    // Confirmed, because scanExhibitAction and transcribeExhibitAction both
    // return normally straight after this and the page re-renders as though
    // the scan were stored. A silent drop there spends the caller's tokens on
    // an AI read and reports it as saved.
    const { data: rows, error } = await supabase
      .from('exhibits')
      .update({ scan_data: scan })
      .eq('id', exhibitId)
      .select('id');
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error(NOT_WRITTEN);
    return;
  }
  const db = await readLocalDB();
  const e = db.exhibits.find((x) => x.id === exhibitId);
  if (!e) return;
  e.scanData = scan;
  await writeLocalDB(db);
}

function profileFromRow(r: ProfileRow): Profile {
  return {
    id: r.id,
    displayName: r.display_name ?? null,
    role: r.role ?? null,
    organization: r.organization ?? null,
    avatarUrl: r.avatar_url ?? null,
    isAdmin: Boolean(r.is_admin),
    isBlocked: Boolean(r.is_blocked),
    representation: r.representation ?? null,
    consentedAt: r.consented_at ?? null,
    tourCompletedAt: r.tour_completed_at ?? null,
    theme: r.theme ?? 'light',
    language: r.language ?? null,
    phoneNumber: r.phone_number ?? null,
    phoneVerifiedAt: r.phone_verified_at ?? null,
    menuPreferences: parseMenuPreferences(
      (r as unknown as { menu_preferences?: unknown }).menu_preferences,
    ),
    updatedAt: r.updated_at,
  };
}

function reviewFromRow(r: AIReviewRow): AIReview {
  return {
    id: r.id,
    caseId: r.case_id,
    jurisdiction: r.jurisdiction ?? '',
    summary: r.summary ?? '',
    timeline: r.timeline ?? [],
    keyFacts: r.key_facts ?? [],
    possibleIssues: r.possible_issues ?? [],
    classification: r.classification ?? '',
    applicableLegalReferences: r.applicable_legal_references ?? [],
    evidenceMapping: r.evidence_mapping ?? [],
    evidenceToStrengthen: r.evidence_to_strengthen ?? [],
    subpoenaTargets: r.subpoena_targets ?? [],
    missingInformation: r.missing_information ?? [],
    suggestedNextSteps: r.suggested_next_steps ?? [],
    questionsForAttorney: r.questions_for_attorney ?? [],
    disclaimer: r.disclaimer ?? '',
    modelUsed: r.model_used ?? '',
    isDemo: r.is_demo,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Local JSON backend (dev / unconfigured mode)
// ---------------------------------------------------------------------------

async function ensureLocalDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function readLocalDB(): Promise<DB> {
  await ensureLocalDirs();
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DB>;
    const cases = (parsed.cases ?? []).map((c) => ({ ...c, posture: c.posture ?? 'claimant' }));
    return {
      cases,
      exhibits: parsed.exhibits ?? [],
      aiReviews: parsed.aiReviews ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        cases: [],
        exhibits: [],
        aiReviews: [],
      };
    }
    throw err;
  }
}

async function writeLocalDB(db: DB) {
  await ensureLocalDirs();
  const tmp = DB_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmp, DB_FILE);
}

function labelFor(n: number): string {
  let s = '';
  let x = n;
  while (true) {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
    if (x < 0) break;
  }
  return s;
}

function sanitizeExt(ext: string): string {
  if (!ext) return '';
  return ext.toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Public API - dispatches on usingSupabase()
// ---------------------------------------------------------------------------

export async function listCases(): Promise<Case[]> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) return [];
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('cases')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data as CaseRow[]).map(caseFromRow);
  }
  const db = await readLocalDB();
  return [...db.cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCase(id: string): Promise<Case | null> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) return null;
    const supabase = createServerSupabase();
    const { data, error } = await supabase.from('cases').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? caseFromRow(data as CaseRow) : null;
  }
  const db = await readLocalDB();
  return db.cases.find((c) => c.id === id) ?? null;
}

export async function createCase(input: {
  title: string;
  subjectName: string;
  subjectType: SubjectType;
  subjectProfile?: SubjectProfile;
  jurisdiction: Jurisdiction;
  caseType: CaseType;
  description: string;
  posture?: Posture;
  hearingAt?: string | null;
  hearingLocation?: string | null;
  hearingNotes?: string | null;
}): Promise<Case> {
  const posture: Posture = input.posture ?? 'claimant';
  const subjectProfile: SubjectProfile = input.subjectProfile ?? {};
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('cases')
      .insert({
        user_id: user.id,
        title: input.title,
        subject_name: input.subjectName,
        subject_type: input.subjectType,
        subject_profile: subjectProfile,
        jurisdiction_country: input.jurisdiction.country,
        jurisdiction_state: input.jurisdiction.state ?? null,
        jurisdiction_city: input.jurisdiction.city ?? null,
        case_type: input.caseType,
        description: input.description,
        posture,
        status: 'draft',
        hearing_at: input.hearingAt ?? null,
        hearing_location: input.hearingLocation ?? null,
        hearing_notes: input.hearingNotes ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return caseFromRow(data as CaseRow);
  }
  const db = await readLocalDB();
  const now = new Date().toISOString();
  const c: Case = {
    id: crypto.randomUUID(),
    title: input.title,
    subjectName: input.subjectName,
    subjectType: input.subjectType,
    subjectProfile,
    jurisdiction: input.jurisdiction,
    caseType: input.caseType,
    description: input.description,
    posture,
    status: 'draft',
    hearingAt: input.hearingAt ?? null,
    hearingLocation: input.hearingLocation ?? null,
    hearingNotes: input.hearingNotes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.cases.push(c);
  await writeLocalDB(db);
  return c;
}

export async function updateCaseHearing(input: {
  caseId: string;
  hearingAt: string | null;
  hearingLocation: string | null;
  hearingNotes: string | null;
}): Promise<void> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();
    // Confirmed, because updateHearingAction writes `hearing_updated` into the
    // audit chain immediately after this returns, and emails the case's
    // collaborators about a hearing date. `cases_update_own` is owner-only
    // while `cases` SELECT is membership-wide, so a collaborator looking at
    // the same case is exactly the caller who updates zero rows here.
    const { data: rows, error } = await supabase
      .from('cases')
      .update({
        hearing_at: input.hearingAt,
        hearing_location: input.hearingLocation,
        hearing_notes: input.hearingNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.caseId)
      .select('id');
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error(NOT_WRITTEN);
    return;
  }
  const db = await readLocalDB();
  const c = db.cases.find((x) => x.id === input.caseId);
  if (!c) throw new Error('Case not found.');
  c.hearingAt = input.hearingAt;
  c.hearingLocation = input.hearingLocation;
  c.hearingNotes = input.hearingNotes;
  c.updatedAt = new Date().toISOString();
  await writeLocalDB(db);
}

/**
 * Raised when the description-history column is not on the database yet.
 *
 * Distinct from every other failure here because there is nothing the person
 * did wrong and nothing they can correct: the migration
 * supabase/migrations/20260822_case_description_history.sql has not been
 * applied. The account is left exactly as it was.
 */
export const COMPOSITION_HISTORY_UNAVAILABLE =
  'Rewriting your account is not switched on for this deployment yet, so nothing was changed. ' +
  'Your existing account and every exhibit are untouched.';

/** PostgREST codes for "that column does not exist" and "not in the schema cache". */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /description_history/.test(error.message ?? '');
}

/**
 * Replace the person's written account of what happened, keeping the old text.
 *
 * `description` and `description_history` are written in ONE update statement.
 * That is the whole design: the new text physically cannot land without the
 * text it replaced landing with it, so no sequencing mistake here or in a
 * future caller can lose the earlier account. This person's account of events
 * is evidence, and the version closest in time to what happened is the one a
 * later reader most needs.
 *
 * Clearing the account is the same operation with an empty string, so a person
 * who deletes their words still keeps the words they deleted. Nothing here
 * touches `cases` rows other than this one, and nothing here touches
 * `exhibits`, `ai_reviews`, or `case_collaborators` at all: deleting the text
 * does not delete the case or any evidence.
 *
 * Throws rather than returning a flag when nothing was written, matching
 * updateCaseStatus and updateCaseHearing. `cases_update_own` is
 * `auth.uid() = user_id` while `cases` SELECT is membership-wide, so a
 * collaborator reading the same case is exactly the caller who updates zero
 * rows here and must not be told the account changed.
 */
export async function updateCaseComposition(input: {
  caseId: string;
  text: string;
}): Promise<{ previous: string; next: string; replacedAt: string }> {
  const next = normalizeComposition(input.text);
  const replacedAt = new Date().toISOString();

  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();
    const { data: current, error: readError } = await supabase
      .from('cases')
      .select('description, description_history')
      .eq('id', input.caseId)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) throw new Error(NOT_WRITTEN);

    const previous = (current as { description: string | null }).description ?? '';
    const history = parseCompositionHistory(
      (current as { description_history?: unknown }).description_history,
    );
    const nextHistory = appendCompositionVersion(history, previous, next, replacedAt);

    const { data: rows, error } = await supabase
      .from('cases')
      .update({
        description: next,
        description_history: nextHistory,
        updated_at: replacedAt,
      })
      .eq('id', input.caseId)
      .select('id');
    if (error) {
      if (isMissingColumnError(error)) {
        console.error('[updateCaseComposition] description_history column missing', error);
        throw new Error(COMPOSITION_HISTORY_UNAVAILABLE);
      }
      throw error;
    }
    if (!rows || rows.length === 0) throw new Error(NOT_WRITTEN);
    return { previous: normalizeComposition(previous), next, replacedAt };
  }

  const db = await readLocalDB();
  const c = db.cases.find((x) => x.id === input.caseId);
  if (!c) throw new Error(NOT_WRITTEN);
  const previous = c.description ?? '';
  c.descriptionHistory = appendCompositionVersion(
    parseCompositionHistory(c.descriptionHistory),
    previous,
    next,
    replacedAt,
  );
  c.description = next;
  c.updatedAt = replacedAt;
  await writeLocalDB(db);
  return { previous: normalizeComposition(previous), next, replacedAt };
}

export type CloseSurveyOutcome =
  | 'resolved'
  | 'settled'
  | 'dropped'
  | 'ongoing_other_tool'
  | 'other';

export async function recordCloseSurvey(input: {
  caseId: string;
  helpfulRating: number | null;
  outcome: CloseSurveyOutcome | null;
  whatWorked: string | null;
  whatCouldImprove: string | null;
  mayContact: boolean;
}): Promise<void> {
  if (!usingSupabase()) return;
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = createServerSupabase();
  const { error } = await supabase.from('close_surveys').insert({
    case_id: input.caseId,
    user_id: user.id,
    helpful_rating: input.helpfulRating,
    outcome: input.outcome,
    what_worked: input.whatWorked,
    what_could_improve: input.whatCouldImprove,
    may_contact: input.mayContact,
  });
  // Don't block close on missing table or RLS issues, log only.
  if (error) {
    console.warn('[close_survey] insert failed (non-fatal):', error.message);
  }
}

/**
 * Move a case to a new status.
 *
 * Throws when nothing was written, rather than returning a flag a caller can
 * forget to read. Two reasons. The local branch below already throws "Case not
 * found." for the same situation, and the two branches disagreeing about
 * whether a missing row is an error is its own defect. And the caller that
 * matters, setCaseStatusAction, writes `case_status_changed` into the audit
 * chain on the next line: a throw stops that line from running, whereas a
 * returned boolean is one careless call site away from a transition being
 * recorded that never happened. That entry is evidence about a legal matter.
 * It has to be un-ignorable.
 */
export async function updateCaseStatus(caseId: string, status: CaseStatus): Promise<void> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();
    const { data: rows, error } = await supabase
      .from('cases')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', caseId)
      .select('id');
    if (error) throw error;
    // `cases_update_own` is `auth.uid() = user_id`, so anyone who can SEE this
    // case without owning it (a collaborator, a firm member) matches zero rows
    // and, before this check existed, was told the status had changed.
    if (!rows || rows.length === 0) throw new Error(NOT_WRITTEN);
    return;
  }
  const db = await readLocalDB();
  const c = db.cases.find((x) => x.id === caseId);
  if (!c) throw new Error('Case not found.');
  c.status = status;
  c.updatedAt = new Date().toISOString();
  await writeLocalDB(db);
}

/**
 * Recursively deletes every object under `prefix` in `bucket`. Supabase
 * Storage's list() is non-recursive and represents subfolders as
 * entries with no `id` - descend into those, delete everything else in
 * one batch per level. Best-effort by design (caller decides whether a
 * failure here should block anything).
 */
async function deleteStorageFolder(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  bucket: string,
  prefix: string,
): Promise<void> {
  const { data: entries } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!entries || entries.length === 0) return;
  const files = entries.filter((e) => e.id !== null).map((e) => `${prefix}/${e.name}`);
  const folders = entries.filter((e) => e.id === null).map((e) => `${prefix}/${e.name}`);
  if (files.length > 0) {
    await admin.storage.from(bucket).remove(files);
  }
  for (const folder of folders) {
    await deleteStorageFolder(admin, bucket, folder);
  }
}

/**
 * Permanently delete a case and all its exhibits, AI reviews, collaborators,
 * and storage objects. Cascades happen at the FK level for child tables;
 * we only need to walk the storage buckets ourselves to clean up files.
 *
 * ORDER IS LOAD-BEARING, and it is the authorization. The row delete runs
 * through the USER-scoped client, so `cases_delete_own` (auth.uid() =
 * user_id) is what decides whether anything happens at all, and it is
 * confirmed with `.select('id')` because PostgREST reports a zero-row
 * delete as a clean success. A caller who does not own this case matches no
 * row, gets NOT_WRITTEN, and never reaches the storage calls below.
 *
 * It used to run the other way round: the service-role client wiped the
 * storage folders first and the unconfirmed row delete followed, so any
 * signed-in caller could destroy another person's Safe Witness evidence,
 * keep the case row, and be told it worked.
 *
 * Partial failure is therefore biased to the recoverable side. Storage
 * cleanup stays best-effort AFTER the row is gone, so a failure there
 * leaves orphaned files that can be reaped later; the alternative,
 * destroyed evidence for a case that still exists, cannot be undone.
 *
 * Throws when the caller does not own the case, when the row does not
 * exist, or when the delete itself errors.
 */
export async function deleteCase(caseId: string): Promise<void> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();
    const admin = createAdminSupabase();

    // Read-only, and it has to happen before the delete: the
    // community_cases row cascades away with the case, and its id is the
    // only handle on the `community-public` folder afterwards. Nothing
    // here destroys anything, so it is safe on this side of the gate.
    let communityCaseId: string | null = null;
    if (admin) {
      try {
        const { data: ccRow } = await admin
          .from('community_cases')
          .select('id')
          .eq('case_id', caseId)
          .maybeSingle();
        communityCaseId = (ccRow as { id: string } | null)?.id ?? null;
      } catch {
        // A missed lookup only costs us the community-public folder.
      }
    }

    // The gate. Nothing irreversible has happened yet.
    const { data: rows, error } = await supabase
      .from('cases')
      .delete()
      .eq('id', caseId)
      .select('id');
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error(NOT_WRITTEN);

    // Past this line the caller is proven to own the case and the row is
    // already gone. We use the admin client (service role) so it can list
    // and delete objects regardless of bucket-level policy.
    if (admin) {
      const folder = `${user.id}/${caseId}`;
      try {
        const { data: files } = await admin.storage
          .from('exhibits')
          .list(folder, { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f) => `${folder}/${f.name}`);
          await admin.storage.from('exhibits').remove(paths);
        }
      } catch {
        // Don't fail the delete if storage cleanup fails - the row delete
        // is the load-bearing part. Orphaned files can be reaped later.
      }

      // Community Case storage. The DB rows (community_cases,
      // witness_submissions, etc.) cascaded away via ON DELETE CASCADE
      // with the case row above, but Supabase Storage objects aren't
      // governed by that FK - ID photos, signatures, evidence files, and
      // gallery images would otherwise sit in storage indefinitely with
      // no DB row pointing at them. This matters more than ordinary
      // orphaned files given the retention obligations already tracked
      // for this feature (see docs/compliance/policies/risk-register.md,
      // R13/R10).
      try {
        await Promise.all([
          deleteStorageFolder(admin, 'community-submissions', caseId),
          communityCaseId
            ? deleteStorageFolder(admin, 'community-public', communityCaseId)
            : Promise.resolve(),
        ]);
      } catch {
        // Same posture as the exhibits cleanup above - best-effort.
      }
    }
    return;
  }
  const db = await readLocalDB();
  const before = db.cases.length;
  db.cases = db.cases.filter((c) => c.id !== caseId);
  if (db.cases.length === before) throw new Error('Case not found.');
  db.exhibits = db.exhibits.filter((e) => e.caseId !== caseId);
  await writeLocalDB(db);
}

export async function listExhibits(caseId: string): Promise<Exhibit[]> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) return [];
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('exhibits')
      .select('*')
      .eq('case_id', caseId)
      .order('uploaded_at', { ascending: true });
    if (error) throw error;
    return (data as ExhibitRow[]).map(exhibitFromRow);
  }
  const db = await readLocalDB();
  return db.exhibits
    .filter((e) => e.caseId === caseId)
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

export async function getExhibitById(id: string): Promise<Exhibit | null> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) return null;
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('exhibits')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? exhibitFromRow(data as ExhibitRow) : null;
  }
  const db = await readLocalDB();
  return db.exhibits.find((e) => e.id === id) ?? null;
}

/**
 * The outcome of adding an exhibit.
 *
 * A REFUSAL - no session, a case that is not the caller's, a file the
 * magic-byte screen will not accept - is an expected outcome, so it travels
 * as a value. It used to be thrown, and React strips an error's message when
 * it crosses the Server Action boundary in a production build, so every
 * refusal reached the person as "An error occurred in the Server Components
 * render. The specific message is omitted in production builds...". Each of
 * those reasons was written for someone to read, so it has to be returned.
 *
 * Genuine internal failures (a PostgREST error, a storage outage) still
 * throw. Those are unexpected, they are not sentences for a person, and the
 * error boundary already turns them into calm copy plus a support reference.
 *
 * Same shape, and same reason, as inviteCollaboratorAction.
 */
export type AddExhibitResult =
  | { ok: true; exhibit: Exhibit }
  | { ok: false; error: string };

export async function addExhibit(input: {
  caseId: string;
  file: File;
  description: string;
  incidentDate?: string | null;
  source?: string | null;
  category?: string | null;
}): Promise<AddExhibitResult> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Not signed in.' };
    const supabase = createServerSupabase();

    // Confirm case ownership (RLS will enforce, but we want a clean error).
    const { data: caseRow, error: caseErr } = await supabase
      .from('cases')
      .select('id')
      .eq('id', input.caseId)
      .maybeSingle();
    if (caseErr) throw caseErr;
    if (!caseRow) return { ok: false, error: 'Case not found.' };

    const { count, error: countErr } = await supabase
      .from('exhibits')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', input.caseId);
    if (countErr) throw countErr;

    const label = `Exhibit ${labelFor(count ?? 0)}`;
    const id = crypto.randomUUID();
    const ext = sanitizeExt(path.extname(input.file.name));
    const storagePath = `${user.id}/${input.caseId}/${id}${ext}`;

    const buf = Buffer.from(await input.file.arrayBuffer());
    // Magic-byte screen: block HTML/SVG/executables + content-confusion
    // (e.g. a renamed .svg declared as application/pdf) before the bytes
    // land in storage. (Audit 2026-07-03, H3.)
    {
      const { screenAuthenticatedUpload } = await import('./upload-safety');
      const screen = screenAuthenticatedUpload(
        buf,
        input.file.type || null,
        50 * 1024 * 1024,
      );
      if (!screen.ok) return { ok: false, error: screen.reason };
    }
    const { error: uploadErr } = await supabase.storage
      .from(EXHIBITS_BUCKET)
      .upload(storagePath, buf, {
        contentType: input.file.type || 'application/octet-stream',
        upsert: false,
      });
    if (uploadErr) throw uploadErr;

    const { data, error } = await supabase
      .from('exhibits')
      .insert({
        id,
        case_id: input.caseId,
        user_id: user.id,
        label,
        file_name: input.file.name,
        storage_path: storagePath,
        file_type: input.file.type || 'application/octet-stream',
        file_size: input.file.size,
        description: input.description,
        incident_date: input.incidentDate ?? null,
        source: input.source ?? null,
        category: input.category ?? null,
      })
      .select('*')
      .single();
    if (error) {
      await supabase.storage.from(EXHIBITS_BUCKET).remove([storagePath]).catch(() => {});
      throw error;
    }

    // Not confirmed, on purpose: this only freshens the case's "updated"
    // timestamp after the exhibit insert above, which IS confirmed and throws.
    // A dropped bump leaves one sort column stale until the next write. It
    // makes no claim to anyone and records nothing.
    await supabase
      .from('cases')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', input.caseId);

    return { ok: true, exhibit: exhibitFromRow(data as ExhibitRow) };
  }

  const db = await readLocalDB();
  const caseRecord = db.cases.find((c) => c.id === input.caseId);
  if (!caseRecord) {
    return { ok: false, error: 'Case not found.' };
  }
  const existingForCase = db.exhibits.filter((e) => e.caseId === input.caseId);
  const label = `Exhibit ${labelFor(existingForCase.length)}`;

  const id = crypto.randomUUID();
  const ext = sanitizeExt(path.extname(input.file.name));
  const storedFileName = `${id}${ext}`;
  const buf = Buffer.from(await input.file.arrayBuffer());
  await ensureLocalDirs();
  await fs.writeFile(path.join(UPLOADS_DIR, storedFileName), buf);

  const exhibit: Exhibit = {
    id,
    caseId: input.caseId,
    label,
    fileName: input.file.name,
    storedFileName,
    fileType: input.file.type || 'application/octet-stream',
    fileSize: input.file.size,
    description: input.description,
    incidentDate: input.incidentDate ?? null,
    source: input.source ?? null,
    category: input.category ?? null,
    uploadedAt: new Date().toISOString(),
  };
  db.exhibits.push(exhibit);
  caseRecord.updatedAt = exhibit.uploadedAt;
  await writeLocalDB(db);
  return { ok: true, exhibit };
}

export async function getLatestReview(caseId: string): Promise<AIReview | null> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) return null;
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('ai_reviews')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? reviewFromRow(data as AIReviewRow) : null;
  }
  const db = await readLocalDB();
  const reviews = db.aiReviews
    .filter((r) => r.caseId === caseId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return reviews[0] ?? null;
}

export async function saveReview(review: AIReview): Promise<void> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();
    const { error } = await supabase.from('ai_reviews').insert({
      id: review.id,
      case_id: review.caseId,
      user_id: user.id,
      jurisdiction: review.jurisdiction,
      summary: review.summary,
      timeline: review.timeline,
      key_facts: review.keyFacts,
      possible_issues: review.possibleIssues,
      classification: review.classification,
      applicable_legal_references: review.applicableLegalReferences ?? [],
      evidence_mapping: review.evidenceMapping,
      evidence_to_strengthen: review.evidenceToStrengthen ?? [],
      subpoena_targets: review.subpoenaTargets ?? [],
      missing_information: review.missingInformation,
      suggested_next_steps: review.suggestedNextSteps,
      questions_for_attorney: review.questionsForAttorney,
      disclaimer: review.disclaimer,
      model_used: review.modelUsed,
      is_demo: review.isDemo,
    });
    if (error) throw error;
    // Not confirmed, on purpose. The review insert above is confirmed and
    // throws, and `review_run` (the audit entry the caller writes) is about
    // that insert, so the entry stays true either way. This line only nudges a
    // status a collaborator is not allowed to set; when it does not land the
    // case keeps the status it already had, which every surface reads back
    // from the row rather than assuming. Nothing is told otherwise.
    await supabase
      .from('cases')
      .update({ status: 'under_review', updated_at: review.createdAt })
      .eq('id', review.caseId);
    return;
  }
  const db = await readLocalDB();
  db.aiReviews.push(review);
  const c = db.cases.find((c) => c.id === review.caseId);
  if (c) {
    c.status = 'under_review';
    c.updatedAt = review.createdAt;
  }
  await writeLocalDB(db);
}

/**
 * Retrieves a signed URL to read an exhibit (Supabase mode) or returns null
 * (local mode - the file route reads from disk directly).
 */
export async function getExhibitSignedUrl(
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  if (!usingSupabase()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data, error } = await supabase.storage
    .from(EXHIBITS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Reads the bytes of an exhibit file. Used by the PDF generator for embedding
 * images directly. Returns null if the file can't be read (unsupported type
 * or missing).
 */
export async function getExhibitFileBuffer(exhibit: Exhibit): Promise<Buffer | null> {
  if (usingSupabase()) {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.storage
      .from(EXHIBITS_BUCKET)
      .download(exhibit.storedFileName);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  try {
    const filePath = path.join(UPLOADS_DIR, path.basename(exhibit.storedFileName));
    if (path.dirname(filePath) !== UPLOADS_DIR) return null;
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Profile (Supabase-only; local mode has no concept of user)
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<Profile | null> {
  if (!usingSupabase()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? profileFromRow(data as ProfileRow) : null;
}

// ---------------------------------------------------------------------------
// Admin views - use the service role key to bypass RLS. Never call from a
// page without first verifying the requester is an admin.
// ---------------------------------------------------------------------------

export type AdminUserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  displayName: string | null;
  role: string | null;
  organization: string | null;
  isAdmin: boolean;
  isBlocked: boolean;
  isPermanentAdmin: boolean;
  representation: RepresentationStatus | null;
  consentedAt: string | null;
  caseCount: number;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionTier: Tier | null;
};

export type AdminCaseRow = Case & {
  ownerId: string;
  ownerEmail: string;
  ownerDisplayName: string | null;
};

// ---------------------------------------------------------------------------
// Feedback - bug reports / suggestions submitted by users from /feedback.
// Admins triage everything from /admin/feedback.
// ---------------------------------------------------------------------------

export type FeedbackCategory = 'bug' | 'suggestion' | 'praise' | 'other';
export type FeedbackStatus = 'new' | 'triaged' | 'resolved' | 'wontfix';

export type FeedbackRow = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  category: FeedbackCategory;
  subject: string;
  body: string;
  urlAtSubmit: string | null;
  userAgent: string | null;
  status: FeedbackStatus;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

type FeedbackDbRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  category: FeedbackCategory;
  subject: string;
  body: string;
  url_at_submit: string | null;
  user_agent: string | null;
  status: FeedbackStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

function feedbackFromRow(r: FeedbackDbRow): FeedbackRow {
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    userDisplayName: r.user_display_name,
    category: r.category,
    subject: r.subject,
    body: r.body,
    urlAtSubmit: r.url_at_submit,
    userAgent: r.user_agent,
    status: r.status,
    adminNotes: r.admin_notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createFeedback(input: {
  category: FeedbackCategory;
  subject: string;
  body: string;
  urlAtSubmit?: string | null;
  userAgent?: string | null;
}): Promise<FeedbackRow> {
  if (!usingSupabase()) throw new Error('Feedback requires Supabase to be configured.');
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('feedback')
    .insert({
      user_id: user.id,
      user_email: user.email ?? null,
      user_display_name: displayName,
      category: input.category,
      subject: input.subject,
      body: input.body,
      url_at_submit: input.urlAtSubmit ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return feedbackFromRow(data as FeedbackDbRow);
}

export async function listMyFeedback(): Promise<FeedbackRow[]> {
  if (!usingSupabase()) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as FeedbackDbRow[]).map(feedbackFromRow);
}

export async function adminListFeedback(input?: {
  status?: FeedbackStatus | 'all';
}): Promise<FeedbackRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];
  let q = admin.from('feedback').select('*').order('created_at', { ascending: false });
  if (input?.status && input.status !== 'all') {
    q = q.eq('status', input.status);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data as FeedbackDbRow[]).map(feedbackFromRow);
}

export async function adminUpdateFeedback(input: {
  id: string;
  status?: FeedbackStatus;
  adminNotes?: string | null;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) throw new Error('Service role key required.');
  const update: Record<string, unknown> = {};
  if (input.status) update.status = input.status;
  if (input.adminNotes !== undefined) update.admin_notes = input.adminNotes;
  if (Object.keys(update).length === 0) return;
  const { error } = await admin.from('feedback').update(update).eq('id', input.id);
  if (error) throw error;
}

export async function adminListUsers(): Promise<AdminUserRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  // Pull all auth users (paginate up to 1000 - fine for our scale; expand if needed).
  const { data: users, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) throw usersErr;

  const ids = users.users.map((u) => u.id);
  const sentinelIds = ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];

  const [profilesResp, casesResp, subsResp] = await Promise.all([
    admin.from('profiles').select('*').in('id', sentinelIds),
    admin.from('cases').select('user_id'),
    admin.from('subscriptions').select('user_id, status, tier').in('user_id', sentinelIds),
  ]);

  if (profilesResp.error) throw profilesResp.error;
  if (casesResp.error) throw casesResp.error;
  if (subsResp.error) throw subsResp.error;

  const profiles = new Map<string, ProfileRow>();
  for (const p of (profilesResp.data ?? []) as ProfileRow[]) profiles.set(p.id, p);

  const caseCounts = new Map<string, number>();
  for (const c of (casesResp.data ?? []) as { user_id: string }[]) {
    caseCounts.set(c.user_id, (caseCounts.get(c.user_id) ?? 0) + 1);
  }

  const subs = new Map<string, { status: SubscriptionStatus; tier: Tier | null }>();
  for (const s of (subsResp.data ?? []) as {
    user_id: string;
    status: SubscriptionStatus;
    tier: Tier | null;
  }[]) {
    subs.set(s.user_id, { status: s.status, tier: s.tier });
  }

  return users.users.map((u) => {
    const p = profiles.get(u.id);
    const s = subs.get(u.id);
    return {
      id: u.id,
      email: u.email ?? '',
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      displayName: p?.display_name ?? null,
      role: p?.role ?? null,
      organization: p?.organization ?? null,
      isAdmin: Boolean(p?.is_admin),
      isBlocked: Boolean(p?.is_blocked),
      isPermanentAdmin: PERMANENT_ADMIN_EMAILS.has((u.email ?? '').toLowerCase()),
      representation: p?.representation ?? null,
      consentedAt: p?.consented_at ?? null,
      caseCount: caseCounts.get(u.id) ?? 0,
      subscriptionStatus: s?.status ?? null,
      subscriptionTier: s?.tier ?? null,
    };
  });
}

/**
 * Flip the admin flag for a user. Enforces a 2-admin minimum so the org
 * can never end up with no admins (or a single admin that locks themselves
 * out by toggling). Throws on policy violation.
 */
// Two operator accounts that always remain admins and unblockable. These
// are the people who keep the lights on for the org. Any UI / API attempt
// to demote, block, or otherwise demote them is refused server-side.
const PERMANENT_ADMIN_EMAILS = new Set(['contact@technooptics.com', 'contact@advottic.com']);

async function isPermanentAdmin(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  userId: string,
): Promise<boolean> {
  const { data } = await admin.auth.admin.getUserById(userId);
  const email = (data?.user?.email ?? '').toLowerCase();
  return PERMANENT_ADMIN_EMAILS.has(email);
}

export async function adminSetUserAdmin(input: {
  userId: string;
  isAdmin: boolean;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) throw new Error('Service role key required.');
  if (!input.isAdmin) {
    // Demoting: refuse outright if this is one of the permanent admins.
    if (await isPermanentAdmin(admin, input.userId)) {
      throw new Error(
        'This is a permanent operator account and cannot have admin removed.',
      );
    }
    // Otherwise confirm there will still be at least 2 admins after.
    const { count, error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true);
    if (error) throw error;
    if ((count ?? 0) <= 2) {
      throw new Error(
        'There must always be at least 2 admins. Promote another user to admin before demoting this one.',
      );
    }
  }
  await ensureProfileExists(admin, input.userId);
  const { error } = await admin
    .from('profiles')
    .update({ is_admin: input.isAdmin, updated_at: new Date().toISOString() })
    .eq('id', input.userId);
  if (error) throw error;
}

/**
 * Activate or deactivate (block) a user account. Blocked users get bounced
 * back to the sign-in page on their next request to /auth/callback. We
 * also force-sign-out any active sessions so the change takes effect
 * immediately.
 */
export async function adminSetUserBlocked(input: {
  userId: string;
  isBlocked: boolean;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) throw new Error('Service role key required.');
  if (input.isBlocked && (await isPermanentAdmin(admin, input.userId))) {
    throw new Error(
      'This is a permanent operator account and cannot be deactivated.',
    );
  }
  await ensureProfileExists(admin, input.userId);
  const { error } = await admin
    .from('profiles')
    .update({ is_blocked: input.isBlocked, updated_at: new Date().toISOString() })
    .eq('id', input.userId);
  if (error) throw error;
  if (input.isBlocked) {
    // Force-revoke active sessions for the user so they can't keep poking
    // around with a cookie that's still valid in the browser.
    try {
      await admin.auth.admin.signOut(input.userId, 'global');
    } catch {
      // signOut by user_id requires a recent supabase-js; if it errors,
      // the next /auth/callback hit will catch it.
    }
  }
}

/**
 * Make sure a profile row exists for the user before we patch flags.
 *
 * This is what lets the two flag updates that follow it stay plain
 * error-checked writes: they run on the service-role client, so no RLS can
 * filter them, and the only other way to match zero rows is for the row to be
 * absent, which this rules out. That argument only holds if a failure here is
 * a failure, so the error is read. Swallowed, it would hand "the account is
 * now deactivated" to an operator for an account that is not.
 */
async function ensureProfileExists(
  admin: ReturnType<typeof createAdminSupabase>,
  userId: string,
): Promise<void> {
  if (!admin) return;
  const { error } = await admin.from('profiles').upsert(
    { id: userId, updated_at: new Date().toISOString() },
    { onConflict: 'id', ignoreDuplicates: false },
  );
  if (error) throw error;
}

export async function adminListCases(
  options: { includeSandbox?: boolean } = {},
): Promise<AdminCaseRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  // Audit V2 (P2 follow-up): hide sandbox-flagged test cases from the
  // operator default view. Callers can pass includeSandbox=true to see
  // everything (the page-level toggle is what flips it on).
  let query = admin
    .from('cases')
    .select('*')
    .order('updated_at', { ascending: false });
  if (!options.includeSandbox) {
    query = query.eq('sandbox', false);
  }
  const { data: cases, error } = await query;
  if (error) throw error;

  const owners = Array.from(new Set((cases as CaseRow[]).map((c) => c.user_id)));
  const [usersResp, profilesResp] = await Promise.all([
    admin.auth.admin.listUsers(),
    admin
      .from('profiles')
      .select('id, display_name')
      .in('id', owners.length ? owners : ['00000000-0000-0000-0000-000000000000']),
  ]);
  if (usersResp.error) throw usersResp.error;
  if (profilesResp.error) throw profilesResp.error;

  const emails = new Map<string, string>();
  for (const u of usersResp.data.users) emails.set(u.id, u.email ?? '');

  const names = new Map<string, string | null>();
  for (const p of (profilesResp.data ?? []) as { id: string; display_name: string | null }[]) {
    names.set(p.id, p.display_name);
  }

  return (cases as CaseRow[]).map((row) => ({
    ...caseFromRow(row),
    ownerId: row.user_id,
    ownerEmail: emails.get(row.user_id) ?? '',
    ownerDisplayName: names.get(row.user_id) ?? null,
  }));
}

/**
 * One case, read with the service-role client for HQ.
 *
 * `getCase` is user-scoped, and `public.cases` has no admin bypass in its
 * SELECT policies, so an operator opening a case they do not personally own
 * or collaborate on got a 404 from a table that had just listed the row.
 * This is the deliberate privileged read path instead: it is admin-only at
 * the route, and the route writes an audit row for every view. No RLS
 * policy was widened to make it work.
 */
export async function adminGetCase(id: string): Promise<AdminCaseRow | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data, error } = await admin.from('cases').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as CaseRow;

  const [userResp, profileResp] = await Promise.all([
    admin.auth.admin.getUserById(row.user_id),
    admin.from('profiles').select('display_name').eq('id', row.user_id).maybeSingle(),
  ]);

  return {
    ...caseFromRow(row),
    ownerId: row.user_id,
    ownerEmail: userResp.data?.user?.email ?? '',
    ownerDisplayName:
      ((profileResp.data as { display_name: string | null } | null)?.display_name) ?? null,
  };
}

export async function adminGetCounts(): Promise<{
  users: number;
  cases: number;
  exhibits: number;
  reviews: number;
}> {
  const admin = createAdminSupabase();
  if (!admin) {
    return { users: 0, cases: 0, exhibits: 0, reviews: 0 };
  }
  const [users, cases, exhibits, reviews] = await Promise.all([
    admin.auth.admin.listUsers().then((r) => r.data.users.length),
    // Exclude sandbox cases from HQ stat counts (audit 2026-05-12 P2).
    admin
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .eq('sandbox', false)
      .then((r) => r.count ?? 0),
    admin
      .from('exhibits')
      .select('id', { count: 'exact', head: true })
      .then((r) => r.count ?? 0),
    admin
      .from('ai_reviews')
      .select('id', { count: 'exact', head: true })
      .then((r) => r.count ?? 0),
  ]);
  return { users, cases, exhibits, reviews };
}

// ---------------------------------------------------------------------------
// Collaborators (Supabase-only - local mode has no concept of multiple users)
// ---------------------------------------------------------------------------

type CollaboratorRow = {
  id: string;
  case_id: string;
  user_id: string | null;
  email: string;
  role: CollaboratorRole;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  witness_statement: string | null;
  witness_statement_updated_at: string | null;
};

function collaboratorFromRow(r: CollaboratorRow): Collaborator {
  return {
    id: r.id,
    caseId: r.case_id,
    userId: r.user_id,
    email: r.email,
    role: r.role,
    invitedBy: r.invited_by,
    invitedAt: r.invited_at,
    acceptedAt: r.accepted_at,
    witnessStatement: r.witness_statement ?? null,
    witnessStatementUpdatedAt: r.witness_statement_updated_at ?? null,
  };
}

/**
 * Witness self-edit: a witness invited to a case writes their own
 * account of what happened. Verifies the caller is the witness in
 * question, then confirms the write actually landed.
 *
 * The ownership check below reads the row through the SELECT policy and the
 * update writes through the UPDATE policy, and those are two different gates.
 * Passing the first says nothing about the second. In the schema committed to
 * this repo, `case_collaborators` has RLS enabled and SELECT, INSERT and
 * DELETE policies, and NO update policy at all, which would make every write
 * here match zero rows; the previous comment claimed the opposite ("we also
 * gate on UPDATE here"). Whatever the live policy set turns out to be, the
 * caller writes `witness_statement_updated` into the audit chain on the
 * strength of this returning, so it has to be the row count that decides.
 */
export async function updateWitnessStatement(input: {
  collaboratorId: string;
  statement: string;
}): Promise<void> {
  if (!usingSupabase()) {
    throw new Error('Witness statements require Supabase to be configured.');
  }
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  const supabase = createServerSupabase();
  // Pull the row to confirm the current user is the witness on it.
  const { data: row } = await supabase
    .from('case_collaborators')
    .select('user_id, role, email')
    .eq('id', input.collaboratorId)
    .maybeSingle();
  const r = row as { user_id?: string | null; role?: CollaboratorRole; email?: string } | null;
  if (!r) throw new Error('Witness invite not found.');
  if (r.role !== 'witness') {
    throw new Error('That collaborator is not a witness.');
  }
  // Either the linked user_id matches, OR the caller's email matches
  // the row's email (covers the case where the witness clicked the
  // accept link, signed up, but user_id-link sync hasn't happened yet).
  const isOwn =
    r.user_id === user.id ||
    (user.email && r.email && user.email.trim().toLowerCase() === r.email.trim().toLowerCase());
  if (!isOwn) throw new Error('You can only edit your own witness statement.');
  const trimmed = input.statement.trim().slice(0, 50_000);
  const { data: rows, error } = await supabase
    .from('case_collaborators')
    .update({
      witness_statement: trimmed || null,
      witness_statement_updated_at: trimmed ? new Date().toISOString() : null,
    })
    .eq('id', input.collaboratorId)
    .select('id');
  if (error) throw error;
  if (!rows || rows.length === 0) {
    throw new Error(
      'Your statement could not be saved. Nothing has been recorded, so please try again before relying on it.',
    );
  }
}

export async function listCollaborators(caseId: string): Promise<Collaborator[]> {
  if (!usingSupabase()) return [];
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('case_collaborators')
    .select('*')
    .eq('case_id', caseId)
    .order('invited_at', { ascending: true });
  if (error) throw error;
  return (data as CollaboratorRow[]).map(collaboratorFromRow);
}

/** Resolve an auth user's id by email (service-role read of auth.users). */
async function lookupUserIdByEmail(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  email: string,
): Promise<string | null> {
  const { data: usersResp } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const match = usersResp.users.find(
    (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
  );
  return match ? match.id : null;
}

/**
 * Email a collaborator their sign-up / sign-in link. We generate the auth
 * link server-side (via the admin API) and deliver it through Resend,
 * because Supabase's built-in email service is heavily rate-limited
 * (~3-4/hour on the free tier) and frequently doesn't deliver to real
 * inboxes. If RESEND_API_KEY isn't configured, we fall back to Supabase's
 * built-in email path so the invite still has a chance of going out.
 *
 * Best-effort: returns false (never throws) on any send failure, so the
 * invite row stays in place and the collaborator can still sign up with
 * the matching email later.
 */
async function deliverCollaboratorInviteEmail(params: {
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>;
  email: string;
  caseId: string;
  caseTitle: string;
  existingUserId: string | null;
  inviterName: string;
  inviterEmail: string | null;
  /** When set, send the premium branded WELCOME email (with login guidance +
   *  screenshots) instead of the terse invite. Passed by the firm invite path. */
  welcome?: {
    inviteeName?: string | null;
    organization?: string | null;
    firmName?: string | null;
    roleLabel: string;
  } | null;
}): Promise<boolean> {
  const { admin, email, caseId, caseTitle, existingUserId, inviterName, inviterEmail } =
    params;
  const welcome = params.welcome ?? null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';
  const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent('/cases?welcome=1')}`;
  try {
    let actionLink: string | null = null;
    if (existingUserId) {
      const linkRes = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo },
      });
      actionLink = linkRes.data.properties?.action_link ?? null;
    } else {
      const linkRes = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo,
          data: {
            invited_to_case: caseId,
            invited_to_case_title: caseTitle,
            invited_by: inviterEmail ?? '',
          },
        },
      });
      actionLink = linkRes.data.properties?.action_link ?? null;
    }

    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (actionLink && resendKey) {
      const subject = welcome
        ? `${inviterName} invited you to "${caseTitle}" on Advottic`
        : existingUserId
          ? `${inviterName} added you to "${caseTitle}" on Advottic`
          : `${inviterName} invited you to "${caseTitle}" on Advottic`;
      const html = welcome
        ? buildCounselWelcomeEmailHtml({
            inviteeName: welcome.inviteeName,
            organization: welcome.organization,
            inviterName,
            firmName: welcome.firmName,
            caseTitle,
            roleLabel: welcome.roleLabel,
            link: actionLink,
          })
        : buildInviteEmailHtml({
            inviterName,
            caseTitle,
            link: actionLink,
            isNewUser: !existingUserId,
          });
      const result = await sendEmail({
        to: email,
        subject,
        html,
        replyTo: inviterEmail ?? undefined,
      });
      return result.ok;
    }
    // No Resend configured (or generateLink failed) - fall back to
    // Supabase's built-in delivery so the invite still has a chance.
    if (existingUserId) {
      await admin.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
    } else {
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          invited_to_case: caseId,
          invited_to_case_title: caseTitle,
          invited_by: inviterEmail ?? '',
        },
      });
    }
    return true;
  } catch (err) {
    console.error('[deliverCollaboratorInviteEmail] email failed', err);
    return false;
  }
}

export async function inviteCollaborator(input: {
  caseId: string;
  email: string;
  role: CollaboratorRole;
}): Promise<{ collaborator: Collaborator; emailed: boolean }> {
  if (!usingSupabase()) {
    throw new Error('Collaborators require Supabase to be configured.');
  }
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  const supabase = createServerSupabase();

  // Confirm caller owns the case
  const { data: caseRow, error: caseErr } = await supabase
    .from('cases')
    .select('id, title')
    .eq('id', input.caseId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) throw new Error('Only the case owner can invite collaborators.');

  // Look up existing user (via service role to read auth.users)
  const admin = createAdminSupabase();
  const existingUserId = admin
    ? await lookupUserIdByEmail(admin, input.email)
    : null;

  const email = input.email.toLowerCase();
  const row = {
    case_id: input.caseId,
    email,
    role: input.role,
    user_id: existingUserId,
    invited_by: user.id,
    accepted_at: existingUserId ? new Date().toISOString() : null,
  };

  // INSERT, not upsert, through the member client.
  //
  // A PostgREST upsert is INSERT ... ON CONFLICT DO UPDATE SET <every column
  // in the payload>, and Postgres wants UPDATE privilege on every column in
  // that SET list. Since the applied migration
  // supabase/migrations/20260810_update_policies_collaborators_exhibits.sql,
  // `authenticated` holds UPDATE on witness_statement and
  // witness_statement_updated_at and nothing else, deliberately: `role` is
  // what private.can_add_to_case reads, so a collaborator able to write it
  // could promote themselves. Postgres tests that grant when it PLANS the
  // statement, so the upsert was refused even for a brand new email that
  // could never have conflicted, and every consumer invite failed.
  //
  // A plain insert needs only INSERT, which the member client still holds,
  // and it keeps the owner-scoped INSERT policy on the write where the
  // common case belongs. Widening the grant back is not an option: it would
  // re-open the self-promotion the migration closed.
  let { data, error } = await supabase
    .from('case_collaborators')
    .insert(row)
    .select('*')
    .single();

  // 23505 on case_collaborators_case_email_unique: they are already on the
  // case and the owner is changing their role or re-sending the invite. That
  // half genuinely cannot go through the member client any more, so it takes
  // the service-role path the firm invite already uses. The case-ownership
  // check above is what authorizes it, and the write is pinned to this case
  // and this email so it cannot reach another matter's row.
  if (error && (error as { code?: string }).code === '23505') {
    if (!admin) {
      throw new Error(
        'That person is already on this case, and their role could not be updated. Nothing has changed.',
      );
    }
    ({ data, error } = await admin
      .from('case_collaborators')
      .update({
        role: row.role,
        user_id: row.user_id,
        accepted_at: row.accepted_at,
        invited_by: row.invited_by,
      })
      .eq('case_id', input.caseId)
      .eq('email', email)
      .select('*')
      .single());
  }
  if (error) throw error;

  const emailed = admin
    ? await deliverCollaboratorInviteEmail({
        admin,
        email,
        caseId: input.caseId,
        caseTitle: caseRow.title,
        existingUserId,
        inviterName:
          (user.user_metadata?.full_name as string | undefined) ??
          user.email ??
          'A colleague',
        inviterEmail: user.email ?? null,
      })
    : false;

  return { collaborator: collaboratorFromRow(data as CollaboratorRow), emailed };
}

/**
 * Firm-side invite: a law firm invites someone to a matter it owns.
 *
 * Unlike inviteCollaborator (which authorizes the case OWNER and writes
 * through the user-scoped client), the caller here is a firm member who
 * is NOT the case's row owner, so RLS on case_collaborators would reject
 * the insert. We therefore write through the service-role client - the
 * same pattern every other firm-case write uses (see firm-actions.ts).
 *
 * Authorization (caller is an owner/admin/attorney of the matter's firm)
 * is enforced by the calling server action; as defense-in-depth we also
 * confirm the case actually belongs to `firmId` before writing.
 */
/** Firm-facing role labels for the branded welcome email. */
const FIRM_WELCOME_ROLE_LABEL: Record<CollaboratorRole, string> = {
  attorney: 'co-counsel',
  represented: 'the represented party',
  editor: 'a contributor',
  viewer: 'a viewer',
  witness: 'a witness',
};

export async function inviteCollaboratorAsFirm(input: {
  caseId: string;
  firmId: string;
  email: string;
  role: CollaboratorRole;
  inviterId: string;
  inviterName: string;
  inviterEmail: string | null;
  /** Optional invitee identity for the premium branded welcome email. */
  inviteeName?: string | null;
  organization?: string | null;
  firmName?: string | null;
}): Promise<{ collaborator: Collaborator; emailed: boolean; caseTitle: string }> {
  if (!usingSupabase()) {
    throw new Error('Collaborators require Supabase to be configured.');
  }
  const admin = createAdminSupabase();
  if (!admin) throw new Error('Server not configured for firm invites.');

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('id, title, firm_id')
    .eq('id', input.caseId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  const cr = caseRow as { id: string; title: string; firm_id: string | null } | null;
  if (!cr || cr.firm_id !== input.firmId) {
    throw new Error('Matter not found for this firm.');
  }

  const email = input.email.toLowerCase();
  const existingUserId = await lookupUserIdByEmail(admin, email);

  const { data, error } = await admin
    .from('case_collaborators')
    .upsert(
      {
        case_id: input.caseId,
        email,
        role: input.role,
        user_id: existingUserId,
        invited_by: input.inviterId,
        accepted_at: existingUserId ? new Date().toISOString() : null,
      },
      { onConflict: 'case_id,email' },
    )
    .select('*')
    .single();
  if (error) throw error;

  const emailed = await deliverCollaboratorInviteEmail({
    admin,
    email,
    caseId: input.caseId,
    caseTitle: cr.title,
    existingUserId,
    inviterName: input.inviterName,
    inviterEmail: input.inviterEmail,
    welcome: {
      inviteeName: input.inviteeName ?? null,
      organization: input.organization ?? null,
      firmName: input.firmName ?? null,
      roleLabel: FIRM_WELCOME_ROLE_LABEL[input.role] ?? 'a collaborator',
    },
  });

  return {
    collaborator: collaboratorFromRow(data as CollaboratorRow),
    emailed,
    caseTitle: cr.title,
  };
}

/**
 * Firm-side list: read a matter's collaborators through the service-role
 * client (the firm member calling this is not the case row owner, so RLS
 * would otherwise return nothing). Verifies the case belongs to `firmId`.
 */
export async function listCollaboratorsAsFirm(
  caseId: string,
  firmId: string,
): Promise<Collaborator[]> {
  if (!usingSupabase()) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  if ((caseRow as { firm_id: string | null } | null)?.firm_id !== firmId) return [];
  const { data, error } = await admin
    .from('case_collaborators')
    .select('*')
    .eq('case_id', caseId)
    .order('invited_at', { ascending: true });
  if (error) throw error;
  return (data as CollaboratorRow[]).map(collaboratorFromRow);
}

/**
 * Firm-side remove: delete a matter collaborator through the service-role
 * client. Verifies the collaborator's case belongs to `firmId` so a
 * caller authorized for one firm can't remove collaborators on another.
 */
export async function removeCollaboratorAsFirm(input: {
  collaboratorId: string;
  firmId: string;
}): Promise<void> {
  if (!usingSupabase()) {
    throw new Error('Collaborators require Supabase to be configured.');
  }
  const admin = createAdminSupabase();
  if (!admin) throw new Error('Server not configured.');
  const { data: collabRow } = await admin
    .from('case_collaborators')
    .select('case_id')
    .eq('id', input.collaboratorId)
    .maybeSingle();
  const caseId = (collabRow as { case_id?: string } | null)?.case_id;
  if (!caseId) return; // already gone
  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  if ((caseRow as { firm_id: string | null } | null)?.firm_id !== input.firmId) {
    throw new Error('Not authorized to remove this collaborator.');
  }
  const { error } = await admin
    .from('case_collaborators')
    .delete()
    .eq('id', input.collaboratorId);
  if (error) throw error;
}

/**
 * Remove a collaborator from a case.
 *
 * Read the row back, exactly as updateWitnessStatement above does, and
 * for the same reason plus a sharper one. The delete runs through the
 * MEMBER client and this table's delete policy is owner-scoped, so a
 * collaborator or firm member who is not the case owner matches zero
 * rows - and PostgREST calls a zero-row DELETE error null, not an error.
 *
 * The caller is removeCollaboratorAction, which writes
 * 'collaborator_removed' into the case audit chain the moment this
 * resolves. Unread, that chain recorded removals that never happened
 * while the person kept their access to the matter. Throwing is the
 * contract this function already had, and it is what stops the audit
 * entry being written.
 */
export async function removeCollaborator(collaboratorId: string): Promise<void> {
  if (!usingSupabase()) throw new Error('Collaborators require Supabase to be configured.');
  const supabase = createServerSupabase();
  const { data: rows, error } = await supabase
    .from('case_collaborators')
    .delete()
    .eq('id', collaboratorId)
    .select('id');
  if (error) throw error;
  if (!rows || rows.length === 0) {
    throw new Error(
      'That person could not be removed, so nothing has changed. Only the case owner can remove someone from a case.',
    );
  }
}

// ---------------------------------------------------------------------------
// Subscriptions (Supabase + Stripe)
// ---------------------------------------------------------------------------

type SubscriptionRow = {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  price_id: string | null;
  tier: Tier | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
};

function subscriptionFromRow(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    userId: r.user_id,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    status: r.status,
    priceId: r.price_id,
    tier: r.tier,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Comp accounts: emails that always have full Pro access without
 * needing a paid Stripe subscription. Used for the founder/owner
 * accounts that demo the product, support customers, and run
 * internal QA. Compared case-insensitively. Add new emails here
 * (lowercase) and they take effect on the next request, no DB
 * write needed.
 */
const COMP_EMAILS: ReadonlySet<string> = new Set([
  'contact@technooptics.com',
  'contact@advottic.com',
  // App Store / Play review sandbox account. Comped so the reviewer
  // always has full Pro access and never hits the trial paywall or a
  // Stripe checkout (App Store Guideline 3.1.1 - no non-IAP purchase
  // path is ever presented to the reviewer).
  'appreview@advottic.com',
]);

function isCompEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return COMP_EMAILS.has(email.trim().toLowerCase());
}

/**
 * Build a synthetic Pro/active subscription for a comp account. Carries
 * a `comp-` prefixed id and null Stripe IDs so it is never confused
 * with a real Stripe-mirrored row. `currentPeriodEnd` is null (no
 * renewal date) and `cancelAtPeriodEnd` is false, mirroring how the
 * billing UI renders an indefinite plan.
 */
function compSubscription(userId: string): Subscription {
  const now = new Date().toISOString();
  return {
    id: `comp-${userId}`,
    userId,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: 'active',
    // Lifetime Ultra: the sentinel price id resolves to the Ultra slug (all
    // Ultra features + uncapped cases) without any Stripe subscription.
    priceId: COMP_ULTRA_PRICE_ID,
    tier: 'pro',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getCurrentSubscription(): Promise<Subscription | null> {
  if (!usingSupabase()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  // Comp accounts (founder / support / QA emails) always read as Pro/active.
  // Skip the DB lookup so the comp grant never gets overwritten by a stale
  // or missing row.
  if (isCompEmail(user.email)) {
    return compSubscription(user.id);
  }
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? subscriptionFromRow(data as SubscriptionRow) : null;
}

/**
 * Read an ARBITRARY user's subscription, not just the signed-in caller's.
 * Firm billing has no firm-level entity of its own (see lib/firm-types.ts) -
 * a firm's plan is really its creator's personal subscription - so the
 * multi-seat Community Case eligibility gate needs to check a firm
 * creator's subscription on behalf of a different, currently-signed-in
 * member. RLS on `subscriptions` only allows reading your own row, so this
 * goes through the service-role client; callers are responsible for
 * scoping how this result is used (never expose it directly to the
 * requesting user beyond a boolean eligibility check).
 */
export async function getSubscriptionForUser(userId: string): Promise<Subscription | null> {
  if (!usingSupabase()) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  if (authUser?.user?.email && isCompEmail(authUser.user.email)) {
    return compSubscription(userId);
  }
  const { data, error } = await admin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? subscriptionFromRow(data as SubscriptionRow) : null;
}

/** Service-role helper: upsert a subscription row from a Stripe webhook. */
export async function upsertSubscriptionFromStripe(input: {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status: SubscriptionStatus;
  priceId?: string | null;
  tier?: Tier | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to record subscription state.');
  const { error } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: input.userId,
        stripe_customer_id: input.stripeCustomerId ?? null,
        stripe_subscription_id: input.stripeSubscriptionId ?? null,
        status: input.status,
        price_id: input.priceId ?? null,
        tier: input.tier ?? null,
        current_period_end: input.currentPeriodEnd ?? null,
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Email-anchored 7-day free trial (defeats delete-and-resign-up reset)
// ---------------------------------------------------------------------------

/** Length of the free trial that starts at signup. Stripe's trial is a
 *  separate, parallel clock - this is the "no Stripe customer at all" track. */
export const FREE_TRIAL_DAYS = 7;

/**
 * When the automatic signup trial ends for one person, or null when there is
 * no anchor to count from.
 *
 * EXTRACTED so there is exactly one definition of this window. HQ has to tell
 * an operator when a user's automatic trial ends, because while it is open
 * isFullAccessTrial unlocks every feature regardless of any plan level HQ has
 * set, and a screen that shows a level without saying that is a screen making
 * a claim the product does not honour. A second copy of this arithmetic in the
 * HQ module would drift from this one, so the HQ reader calls this.
 *
 * The anchor is the EARLIER of the email anchor and the device anchor, which
 * is what defeats the delete-and-resign-up reset. Behaviour is unchanged from
 * the inline version this replaces, with one deliberate exception: an
 * unparseable anchor now returns null rather than throwing a RangeError out of
 * toISOString. Null resolves to no free trial, which is the same net access
 * answer the throw produced once its caller's catch had run, and it does not
 * take a page down.
 */
export function freeTrialWindowEnd(
  emailFirst: string | null | undefined,
  deviceFirst: string | null | undefined,
): string | null {
  const anchor =
    emailFirst && deviceFirst
      ? Date.parse(emailFirst) <= Date.parse(deviceFirst)
        ? emailFirst
        : deviceFirst
      : emailFirst || deviceFirst;
  if (!anchor) return null;
  const ends = new Date(Date.parse(anchor) + FREE_TRIAL_DAYS * 86_400_000);
  return Number.isNaN(ends.getTime()) ? null : ends.toISOString();
}

/**
 * Idempotent upsert into signup_history for the current user. The
 * first time a given email is ever seen, we INSERT with first_signup_at
 * = now. Subsequent calls (same email, even after a delete + new
 * auth.users row) only bump last_signup_at + signup_count, so the
 * trial clock keeps ticking from the original first encounter and a
 * delete/re-create cannot reset it.
 */
export async function ensureSignupHistory(): Promise<void> {
  if (!usingSupabase()) return;
  const user = await getCurrentUser();
  if (!user?.email) return;
  const admin = createAdminSupabase();
  if (!admin) return;
  const email = user.email.trim().toLowerCase();
  // Read-modify-write rather than upsert because we want to bump
  // signup_count on existing rows but NEVER touch first_signup_at.
  const { data: existing } = await admin
    .from('signup_history')
    .select('email, signup_count')
    .eq('email', email)
    .maybeSingle();
  if (existing) {
    await admin
      .from('signup_history')
      .update({
        last_signup_at: new Date().toISOString(),
        signup_count:
          ((existing as { signup_count?: number } | null)?.signup_count ?? 1) + 1,
      })
      .eq('email', email);
  } else {
    await admin.from('signup_history').insert({
      email,
      first_signup_at: new Date().toISOString(),
      last_signup_at: new Date().toISOString(),
      signup_count: 1,
    });
  }
}

/**
 * Returns the effective trial / subscription state for the current
 * user, combining Stripe (subscription row) and the email-anchored
 * free trial (signup_history). Used by both the TrialBanner and the
 * paywall on case creation.
 *
 *   active_subscription  - paying, full access
 *   stripe_trialing      - 7-day Stripe trial after they hit Subscribe
 *   free_trial           - first 7 days from email's first_signup_at
 *   expired              - free trial up + no active sub
 *   none                 - no email / not signed in / Supabase down
 */
export type EffectiveTrialState = {
  mode:
    | 'active_subscription'
    | 'stripe_trialing'
    | 'free_trial'
    | 'expired'
    | 'none';
  /** ISO timestamp of when access flips, or null if not applicable. */
  trialEndsAt: string | null;
  /** Days remaining before the gate falls (0 if already expired). */
  daysRemaining: number;
  /** Subscription tier, if any. */
  tier: Tier | null;
};

export async function getEffectiveTrialState(): Promise<EffectiveTrialState> {
  if (!usingSupabase()) {
    return { mode: 'none', trialEndsAt: null, daysRemaining: 0, tier: null };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { mode: 'none', trialEndsAt: null, daysRemaining: 0, tier: null };
  }
  // Active Stripe subscription (paid or trial) trumps the free trial.
  const sub = await getCurrentSubscription().catch(() => null);
  if (sub?.status === 'active') {
    return {
      mode: 'active_subscription',
      trialEndsAt: sub.currentPeriodEnd ?? null,
      daysRemaining: 0,
      tier: sub.tier ?? null,
    };
  }
  if (sub?.status === 'trialing') {
    const ends = sub.currentPeriodEnd ?? null;
    const days = ends ? Math.max(0, Math.ceil((Date.parse(ends) - Date.now()) / 86_400_000)) : 0;
    return {
      mode: 'stripe_trialing',
      trialEndsAt: ends,
      daysRemaining: days,
      tier: sub.tier ?? null,
    };
  }
  // No active Stripe subscription. Compute the free trial window from
  // signup_history.first_signup_at (which the layout populates on
  // every authed render via ensureSignupHistory).
  if (!user.email) {
    return { mode: 'none', trialEndsAt: null, daysRemaining: 0, tier: null };
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return { mode: 'none', trialEndsAt: null, daysRemaining: 0, tier: null };
  }
  const email = user.email.trim().toLowerCase();
  // Anchor the trial on the EARLIEST of:
  //   1. signup_history.first_signup_at (per email)
  //   2. device_trial_history.first_seen_at  for any device this
  //      user has signed in from (per hardware identifier)
  // This blocks the "delete account, make a new email on the same
  // phone, get a fresh trial" abuse pattern.
  const [emailRowResult, deviceRowsResult] = await Promise.all([
    admin
      .from('signup_history')
      .select('first_signup_at')
      .eq('email', email)
      .maybeSingle(),
    admin
      .from('device_trial_history')
      .select('first_seen_at')
      .eq('latest_user_id', user.id)
      .order('first_seen_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const emailFirst =
    (emailRowResult.data as { first_signup_at?: string } | null)?.first_signup_at ??
    user.created_at ??
    null;
  const deviceFirst =
    (deviceRowsResult.data as { first_seen_at?: string } | null)?.first_seen_at ?? null;
  // The earlier of the two anchors, plus the window. One definition, shared
  // with the HQ reader that has to tell an operator when this window closes.
  const ends = freeTrialWindowEnd(emailFirst, deviceFirst);
  if (!ends) {
    return { mode: 'none', trialEndsAt: null, daysRemaining: 0, tier: null };
  }
  const days = Math.max(0, Math.ceil((Date.parse(ends) - Date.now()) / 86_400_000));
  if (days <= 0) {
    return { mode: 'expired', trialEndsAt: ends, daysRemaining: 0, tier: null };
  }
  return { mode: 'free_trial', trialEndsAt: ends, daysRemaining: days, tier: null };
}

// ---------------------------------------------------------------------------
// Token quota (Pro tier metered usage)
// ---------------------------------------------------------------------------

/**
 * Number of tokens included with the Pro monthly subscription. Reset on
 * each successful renewal via the Stripe webhook. Bella + Advottic Review
 * deduct from the same pool. Match the value documented on /billing.
 */
export const PRO_MONTHLY_TOKEN_GRANT = 1_500_000;

/** Reasons we record on the token_ledger - keep this list in sync with UI labels. */
export type TokenLedgerReason =
  | 'pro_monthly_grant'
  | 'topup_small'
  | 'topup_medium'
  | 'topup_large'
  | 'bella'
  | 'legal_eye'
  | 'admin_adjust'
  // 2026-05-13: per-billing-cycle deduction for cases/contracts past
  // the tier's item cap. Written by lib/item-limits.ts
  // applyMonthlyOverageDebit() during the Stripe renewal webhook.
  | 'item_overage_debit';

export type TokenBalance = {
  balance: number;
  /** ISO timestamp of when the next monthly grant fires, or null. */
  quotaPeriodEnd: string | null;
};

/** Read the signed-in user's current token balance + monthly cycle. */
export async function getTokenBalance(): Promise<TokenBalance> {
  if (!usingSupabase()) return { balance: 0, quotaPeriodEnd: null };
  const user = await getCurrentUser();
  if (!user) return { balance: 0, quotaPeriodEnd: null };
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('token_balance, token_quota_period_end')
    .eq('id', user.id)
    .maybeSingle();
  return {
    balance: (data as { token_balance?: number } | null)?.token_balance ?? 0,
    quotaPeriodEnd:
      (data as { token_quota_period_end?: string } | null)?.token_quota_period_end ?? null,
  };
}

/**
 * Service-role: credit or debit tokens for a given user, recording a
 * row on the token_ledger for audit. Pass a NEGATIVE delta to debit.
 * Returns the new balance. Floors the balance at 0 so we never go
 * negative even if a debit is too big.
 */
export async function adjustTokens(input: {
  userId: string;
  delta: number;
  reason: TokenLedgerReason;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const admin = createAdminSupabase();
  if (!admin) return 0;
  // Read current balance, compute new (clamped at 0), write back, then
  // log. Two round-trips, not transactional; webhook + request paths
  // are low-volume and the worst case under contention is a small
  // off-by-N which the next adjust will correct on next request.
  const { data: profile } = await admin
    .from('profiles')
    .select('token_balance')
    .eq('id', input.userId)
    .maybeSingle();
  const current = (profile as { token_balance?: number } | null)?.token_balance ?? 0;
  const proposed = current + input.delta;
  const next = proposed < 0 ? 0 : proposed;
  const { data: written } = await admin
    .from('profiles')
    .update({ token_balance: next, updated_at: new Date().toISOString() })
    .eq('id', input.userId)
    .select('id');
  // The ledger row below states `balance_after`. If the balance was not
  // written (no profile row for this user id, say), writing the ledger anyway
  // records a balance nobody holds, and this ledger is the record that gets
  // read back when a charge is disputed. Say so on the error channel and leave
  // the ledger alone rather than entering something untrue in it. No throw:
  // the callers are Stripe webhook handlers, and a rejection there buys a
  // retry loop, not a correction.
  if (!written || written.length === 0) {
    console.error(
      `[tokens] balance write for ${input.userId} matched no row; ledger entry skipped (${input.reason})`,
    );
    return current;
  }
  await admin.from('token_ledger').insert({
    user_id: input.userId,
    delta: input.delta,
    reason: input.reason,
    balance_after: next,
    metadata: input.metadata ?? {},
  });
  return next;
}

/**
 * Service-role: list the most recent ledger rows for a user.
 * Used by the /billing page to show usage history.
 */
export type TokenLedgerRow = {
  id: string;
  occurredAt: string;
  delta: number;
  reason: TokenLedgerReason;
  balanceAfter: number | null;
  metadata: Record<string, unknown>;
};

export async function listTokenLedger(input?: { limit?: number }): Promise<TokenLedgerRow[]> {
  if (!usingSupabase()) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('token_ledger')
    .select('*')
    .eq('user_id', user.id)
    .order('occurred_at', { ascending: false })
    .limit(input?.limit ?? 25);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    delta: Number(r.delta),
    reason: r.reason as TokenLedgerReason,
    balanceAfter:
      typeof r.balance_after === 'number' ? r.balance_after : null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

/**
 * Quick check used by Bella + Advottic Review before making the API call.
 * Returns null if the user is not Pro (no metering applies). Returns
 * the current balance if they are Pro - callers should refuse the
 * request when balance <= 0.
 */
export async function getProTokenGate(): Promise<{ tier: Tier | null; balance: number } | null> {
  if (!usingSupabase()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', user.id)
    .maybeSingle();
  const tier = (sub as { tier?: Tier; status?: SubscriptionStatus } | null)?.tier ?? null;
  // Only Pro is metered. Basic + Standard remain flat.
  if (tier !== 'pro') return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('token_balance')
    .eq('id', user.id)
    .maybeSingle();
  return {
    tier,
    balance: (profile as { token_balance?: number } | null)?.token_balance ?? 0,
  };
}

/**
 * Service-role: deduct tokens consumed by a request, but only when
 * the caller is on the Pro tier. No-op for everyone else (and for
 * anonymous one-shot doc reviews where there is no signed-in user).
 */
export async function consumeTokensForCurrentUser(input: {
  amount: number;
  reason: 'bella' | 'legal_eye';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!usingSupabase() || input.amount <= 0) return;
  const user = await getCurrentUser();
  if (!user) return;
  const gate = await getProTokenGate();
  if (!gate) return; // not metered (Basic/Standard)
  await adjustTokens({
    userId: user.id,
    delta: -Math.round(input.amount),
    reason: input.reason,
    metadata: input.metadata,
  });
}

/**
 * Service-role: idempotently grant the Pro monthly token quota.
 * Stripe sends invoice.payment_succeeded on each renewal; we use the
 * Stripe period end as the lock so a webhook retry within the same
 * period does not double-grant.
 */
export async function grantProMonthlyTokens(input: {
  userId: string;
  periodEnd: string; // ISO; the new period_end Stripe just sent us
}): Promise<{ granted: boolean; balance: number }> {
  const admin = createAdminSupabase();
  if (!admin) return { granted: false, balance: 0 };
  const { data: profile } = await admin
    .from('profiles')
    .select('token_balance, token_quota_period_end')
    .eq('id', input.userId)
    .maybeSingle();
  const existing = (profile as {
    token_balance?: number;
    token_quota_period_end?: string;
  } | null) ?? { token_balance: 0 };
  // Already granted for this exact period - skip.
  if (existing.token_quota_period_end === input.periodEnd) {
    return { granted: false, balance: existing.token_balance ?? 0 };
  }
  const newBalance = (existing.token_balance ?? 0) + PRO_MONTHLY_TOKEN_GRANT;
  const { data: written } = await admin
    .from('profiles')
    .update({
      token_balance: newBalance,
      token_quota_period_end: input.periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.userId)
    .select('id');
  // Same reason as adjustTokens: no grant means no ledger row claiming one,
  // and "granted" has to describe what happened rather than what was asked for.
  if (!written || written.length === 0) {
    console.error(
      `[tokens] pro monthly grant for ${input.userId} matched no row; ledger entry skipped`,
    );
    return { granted: false, balance: existing.token_balance ?? 0 };
  }
  await admin.from('token_ledger').insert({
    user_id: input.userId,
    delta: PRO_MONTHLY_TOKEN_GRANT,
    reason: 'pro_monthly_grant',
    balance_after: newBalance,
    metadata: { period_end: input.periodEnd },
  });
  return { granted: true, balance: newBalance };
}

/** Service-role helper: look up user_id given a Stripe customer ID. */
export async function userIdForStripeCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data, error } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { user_id: string }).user_id;
}

export async function upsertProfile(input: {
  displayName?: string | null;
  role?: string | null;
  organization?: string | null;
  avatarUrl?: string | null;
  representation?: RepresentationStatus | null;
  theme?: 'light' | 'dark' | 'system';
  language?: string | null;
}): Promise<Profile> {
  if (!usingSupabase()) throw new Error('Profiles require Supabase to be configured.');
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  const supabase = createServerSupabase();
  const update: Record<string, unknown> = {
    id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (input.displayName !== undefined) update.display_name = input.displayName;
  if (input.role !== undefined) update.role = input.role;
  if (input.organization !== undefined) update.organization = input.organization;
  if (input.avatarUrl !== undefined) update.avatar_url = input.avatarUrl;
  if (input.representation !== undefined) update.representation = input.representation;
  if (input.theme !== undefined) update.theme = input.theme;
  if (input.language !== undefined) update.language = input.language;

  const { data, error } = await supabase
    .from('profiles')
    .upsert(update)
    .select('*')
    .single();
  if (error) throw error;
  return profileFromRow(data as ProfileRow);
}

export async function recordConsent(input: {
  representation: RepresentationStatus;
  displayName?: string | null;
}): Promise<void> {
  if (!usingSupabase()) throw new Error('Supabase required.');
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  const supabase = createServerSupabase();
  const update: Record<string, unknown> = {
    id: user.id,
    representation: input.representation,
    consented_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (input.displayName !== undefined && input.displayName !== null) {
    update.display_name = input.displayName;
  }
  const { error } = await supabase.from('profiles').upsert(update);
  if (error) throw error;
}

export async function markTourCompleted(): Promise<void> {
  if (!usingSupabase()) return;
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = createServerSupabase();
  await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      tour_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
}

// ---------------------------------------------------------------------------
// System health + crash reports
// ---------------------------------------------------------------------------

export type ProbeName = 'auth' | 'database' | 'email' | 'stripe' | 'bella';
export type ProbeStatus = 'pass' | 'fail' | 'skipped';

export type SystemHealthRow = {
  id: string;
  ranAt: string;
  source: 'cron' | 'manual';
  probes: Record<ProbeName, ProbeStatus>;
  failures: { probe: ProbeName; error: string }[];
  durationMs: number | null;
};

export type CrashReport = {
  id: string;
  reportedAt: string;
  userId: string | null;
  url: string | null;
  userAgent: string | null;
  message: string;
  stack: string | null;
  componentStack: string | null;
  release: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

export async function recordHealthCheck(input: {
  source: 'cron' | 'manual';
  probes: Record<ProbeName, ProbeStatus>;
  failures: { probe: ProbeName; error: string }[];
  durationMs: number;
}): Promise<string | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  // postgrest-js resolves with `{ error }` instead of throwing, so this
  // result has to be inspected. An unchecked insert here loses the run
  // silently and leaves the caller unable to tell "not recorded" from
  // "recorded with no id".
  const { data, error } = await admin
    .from('system_health')
    .insert({
      source: input.source,
      probes: input.probes,
      failures: input.failures,
      duration_ms: input.durationMs,
    })
    .select('id')
    .single();
  if (error) {
    console.error(`[health] failed to record health check: ${error.message}`);
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Returns the ISO timestamp of the most recent health-check row that
 * triggered a digest email. The cron compares it against
 * HEALTH_DIGEST_MIN_GAP_MS (lib/hq-metrics.ts) to throttle alerts while a
 * failure persists.
 *
 * Do not reintroduce "once per 24 hours" here. That was the number, and
 * it is what broke the alerting: the window was a full cron period, so a
 * daily run cleared it only when it happened to land later in the minute
 * than the previous send. Replayed over all 237 rows the old rule was a
 * necessary condition for every digest ever sent, and every suppressed
 * run sat in a 98-second band immediately under the bar (86301.9s to
 * 86399.8s, against a smallest passing gap of 86400.055s). The window
 * has to stay meaningfully shorter than the cron period, which is what
 * the test in tests/health-digest-throttle.test.ts pins.
 */
export async function lastHealthEmailSentAt(): Promise<string | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data } = await admin
    .from('system_health')
    .select('email_sent_at')
    .not('email_sent_at', 'is', null)
    .order('email_sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { email_sent_at?: string } | null)?.email_sent_at ?? null;
}

/**
 * Marks a health-check row as having had its digest email sent. Anchors
 * the next throttle window (HEALTH_DIGEST_MIN_GAP_MS in lib/hq-metrics).
 *
 * A dropped update here does not lose an alert, it duplicates one: the
 * next run reads an older anchor and mails again. It still says so,
 * because a `{ error }` nobody reads is how this table stopped being
 * trustworthy in the first place.
 */
export async function markHealthEmailSent(rowId: string): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return;
  const { error } = await admin
    .from('system_health')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('id', rowId);
  if (error) {
    console.error(
      `[health] digest sent but row ${rowId} not marked: ${error.message}`,
    );
  }
}

export async function adminListHealthChecks(limit = 48): Promise<SystemHealthRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data, error } = await admin
    .from('system_health')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    ranAt: String(r.ran_at),
    source: (r.source as 'cron' | 'manual') ?? 'cron',
    probes: (r.probes as Record<ProbeName, ProbeStatus>) ?? ({} as Record<ProbeName, ProbeStatus>),
    failures: (r.failures as { probe: ProbeName; error: string }[]) ?? [],
    durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : null,
  }));
}

export async function recordCrashReport(input: {
  userId: string | null;
  url: string | null;
  userAgent: string | null;
  message: string;
  stack: string | null;
  componentStack: string | null;
  release: string | null;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return;
  // Cap stack/message length so a runaway exception payload cannot
  // bloat a single row beyond what Postgres comfortably handles.
  const cap = (s: string | null, n: number) =>
    s == null ? null : s.length > n ? s.slice(0, n) : s;
  await admin.from('crash_reports').insert({
    user_id: input.userId,
    url: cap(input.url, 1000),
    user_agent: cap(input.userAgent, 500),
    message: cap(input.message, 2000) ?? '(no message)',
    stack: cap(input.stack, 8000),
    component_stack: cap(input.componentStack, 4000),
    release: cap(input.release, 80),
  });
}

export async function adminListCrashReports(input?: {
  includeAcknowledged?: boolean;
  limit?: number;
}): Promise<CrashReport[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];
  let query = admin
    .from('crash_reports')
    .select('*')
    .order('reported_at', { ascending: false })
    .limit(input?.limit ?? 100);
  if (!input?.includeAcknowledged) {
    query = query.is('acknowledged_at', null);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    reportedAt: String(r.reported_at),
    userId: r.user_id ? String(r.user_id) : null,
    url: r.url ? String(r.url) : null,
    userAgent: r.user_agent ? String(r.user_agent) : null,
    message: String(r.message),
    stack: r.stack ? String(r.stack) : null,
    componentStack: r.component_stack ? String(r.component_stack) : null,
    release: r.release ? String(r.release) : null,
    acknowledgedAt: r.acknowledged_at ? String(r.acknowledged_at) : null,
    acknowledgedBy: r.acknowledged_by ? String(r.acknowledged_by) : null,
  }));
}

/**
 * The one place any HQ surface asks "how big is the crash backlog".
 *
 * /admin, /admin/crashes and /admin/security-center used to answer 492, 500
 * and 710 for the same question: two of them derived a count from a capped
 * list (500 was the query cap wearing a count's clothes) and one read the raw
 * total. Deriving all three from this single call - a fixed noise sample plus
 * an uncapped exact count - is the only way they stay equal, because the
 * noise rule is a JS regex over `message` and so depends on how many rows
 * were read.
 */
export async function adminSummarizeOpenCrashes(): Promise<OpenCrashSummary> {
  const admin = createAdminSupabase();
  if (!admin) return { open: 0, noise: 0, total: 0, truncated: false };
  const [sampleResp, countResp] = await Promise.all([
    admin
      .from('crash_reports')
      .select('message')
      .is('acknowledged_at', null)
      .order('reported_at', { ascending: false })
      .limit(OPEN_CRASH_SAMPLE),
    admin
      .from('crash_reports')
      .select('id', { count: 'exact', head: true })
      .is('acknowledged_at', null),
  ]);
  if (sampleResp.error || countResp.error) {
    // Zero here reads on every HQ surface as "no open crashes", which is
    // the opposite of what a failed read means. Nothing downstream can
    // tell the difference from the return value, so say it on the error
    // channel at least.
    console.error(
      `[crashes] open-crash summary read failed: ${
        (sampleResp.error ?? countResp.error)?.message
      }`,
    );
    return { open: 0, noise: 0, total: 0, truncated: false };
  }
  return summarizeOpenCrashes(
    (sampleResp.data ?? []) as Array<{ message: string | null }>,
    countResp.count ?? 0,
  );
}

export async function adminAcknowledgeCrash(crashId: string): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return;
  const user = await getCurrentUser();
  // postgrest-js resolves with `{ error }` rather than throwing. Unchecked,
  // a rejected acknowledge is indistinguishable from a successful one: the
  // action revalidates either way and the row simply reappears.
  const { error } = await admin
    .from('crash_reports')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: user?.id ?? null,
    })
    .eq('id', crashId);
  if (error) {
    console.error(
      `[crashes] failed to acknowledge ${crashId}: ${error.message}`,
    );
  }
}

/**
 * Bulk-acknowledge a group of crash IDs in a single round trip.
 * Used by the grouped /admin/crashes view (audit P2): when 21 rows
 * share the same React #419 signature, "acknowledge group" closes
 * all of them at once instead of forcing an operator to click 21
 * times. Returns the count of rows actually written.
 */
export async function adminAcknowledgeCrashIds(crashIds: string[]): Promise<number> {
  if (crashIds.length === 0) return 0;
  const admin = createAdminSupabase();
  if (!admin) return 0;
  const user = await getCurrentUser();
  // Cap at 500 to keep the IN clause from blowing up. Realistic crash
  // groups are tens, not thousands.
  const ids = crashIds.slice(0, 500);
  const { error, count } = await admin
    .from('crash_reports')
    .update(
      {
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: user?.id ?? null,
      },
      { count: 'exact' },
    )
    .in('id', ids)
    .is('acknowledged_at', null);
  if (error) return 0;
  return count ?? 0;
}
