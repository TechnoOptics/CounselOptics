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
import { createServerSupabase, getCurrentUser, isSupabaseConfigured } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

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
  representation: RepresentationStatus | null;
  consented_at: string | null;
  tour_completed_at: string | null;
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

export async function saveExhibitScan(exhibitId: string, scan: ScanData): Promise<void> {
  if (usingSupabase()) {
    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('exhibits')
      .update({ scan_data: scan })
      .eq('id', exhibitId);
    if (error) throw error;
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
    representation: r.representation ?? null,
    consentedAt: r.consented_at ?? null,
    tourCompletedAt: r.tour_completed_at ?? null,
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
    const { error } = await supabase
      .from('cases')
      .update({
        hearing_at: input.hearingAt,
        hearing_location: input.hearingLocation,
        hearing_notes: input.hearingNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.caseId);
    if (error) throw error;
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

export async function updateCaseStatus(caseId: string, status: CaseStatus): Promise<void> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('cases')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', caseId);
    if (error) throw error;
    return;
  }
  const db = await readLocalDB();
  const c = db.cases.find((x) => x.id === caseId);
  if (!c) throw new Error('Case not found.');
  c.status = status;
  c.updatedAt = new Date().toISOString();
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

export async function addExhibit(input: {
  caseId: string;
  file: File;
  description: string;
  incidentDate?: string | null;
  source?: string | null;
  category?: string | null;
}): Promise<Exhibit> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();

    // Confirm case ownership (RLS will enforce, but we want a clean error).
    const { data: caseRow, error: caseErr } = await supabase
      .from('cases')
      .select('id')
      .eq('id', input.caseId)
      .maybeSingle();
    if (caseErr) throw caseErr;
    if (!caseRow) throw new Error('Case not found.');

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

    await supabase
      .from('cases')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', input.caseId);

    return exhibitFromRow(data as ExhibitRow);
  }

  const db = await readLocalDB();
  const caseRecord = db.cases.find((c) => c.id === input.caseId);
  if (!caseRecord) {
    throw new Error('Case not found');
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
  return exhibit;
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

export async function adminListUsers(): Promise<AdminUserRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  // Pull all auth users (paginate up to 1000 — fine for our scale; expand if needed).
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
      representation: p?.representation ?? null,
      consentedAt: p?.consented_at ?? null,
      caseCount: caseCounts.get(u.id) ?? 0,
      subscriptionStatus: s?.status ?? null,
      subscriptionTier: s?.tier ?? null,
    };
  });
}

export async function adminListCases(): Promise<AdminCaseRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  const { data: cases, error } = await admin
    .from('cases')
    .select('*')
    .order('updated_at', { ascending: false });
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
    admin.from('cases').select('id', { count: 'exact', head: true }).then((r) => r.count ?? 0),
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
  };
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
  let existingUserId: string | null = null;
  if (admin) {
    const { data: usersResp } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const match = usersResp.users.find(
      (u) => (u.email ?? '').toLowerCase() === input.email.toLowerCase(),
    );
    if (match) existingUserId = match.id;
  }

  const email = input.email.toLowerCase();
  const { data, error } = await supabase
    .from('case_collaborators')
    .upsert(
      {
        case_id: input.caseId,
        email,
        role: input.role,
        user_id: existingUserId,
        invited_by: user.id,
        accepted_at: existingUserId ? new Date().toISOString() : null,
      },
      { onConflict: 'case_id,email' },
    )
    .select('*')
    .single();
  if (error) throw error;

  // Email the invitee a sign-up / sign-in link. If they're already a Supabase
  // user, send a magic link; otherwise send Supabase's "invite" email which
  // creates the account on first click.
  let emailed = false;
  if (admin) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';
    const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent('/cases?welcome=1')}`;
    try {
      if (existingUserId) {
        // Existing account: send a magic link they can click to sign in straight to the app.
        await admin.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo },
        });
        // generateLink returns the URL but doesn't email it; send a fresh sign-in OTP instead.
        await admin.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
        });
      } else {
        await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: {
            invited_to_case: input.caseId,
            invited_to_case_title: caseRow.title,
            invited_by: user.email ?? user.id,
          },
        });
      }
      emailed = true;
    } catch {
      // Email send failed (rate limit, bad config, etc). Don't fail the
      // invite itself; the row is in place and the collaborator can sign
      // up on their own with the matching email later.
      emailed = false;
    }
  }

  return { collaborator: collaboratorFromRow(data as CollaboratorRow), emailed };
}

export async function removeCollaborator(collaboratorId: string): Promise<void> {
  if (!usingSupabase()) throw new Error('Collaborators require Supabase to be configured.');
  const supabase = createServerSupabase();
  const { error } = await supabase.from('case_collaborators').delete().eq('id', collaboratorId);
  if (error) throw error;
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

export async function getCurrentSubscription(): Promise<Subscription | null> {
  if (!usingSupabase()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
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
