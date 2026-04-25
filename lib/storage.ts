import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AIReview,
  Case,
  CaseStatus,
  CaseType,
  Exhibit,
  ExhibitPlanItem,
  Jurisdiction,
  Profile,
  SubjectType,
} from './types';
import { createServerSupabase, getCurrentUser, isSupabaseConfigured } from './supabase/server';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const EXHIBITS_BUCKET = 'exhibits';

type DB = {
  cases: Case[];
  exhibits: Exhibit[];
  aiReviews: AIReview[];
  exhibitPlans: ExhibitPlanItem[];
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
  jurisdiction_country: string;
  jurisdiction_state: string | null;
  jurisdiction_city: string | null;
  case_type: string;
  description: string | null;
  status: CaseStatus;
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
  uploaded_at: string;
};

type ExhibitPlanRow = {
  id: string;
  case_id: string;
  user_id: string;
  label: string;
  title: string;
  description: string | null;
  position: number;
  filled_by_exhibit_id: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  role: string | null;
  organization: string | null;
  avatar_url: string | null;
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
    title: r.title,
    subjectName: r.subject_name,
    subjectType: r.subject_type,
    jurisdiction: {
      country: r.jurisdiction_country,
      state: r.jurisdiction_state ?? undefined,
      city: r.jurisdiction_city ?? undefined,
    },
    caseType: r.case_type as CaseType,
    description: r.description ?? '',
    status: r.status,
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
    uploadedAt: r.uploaded_at,
  };
}

function planItemFromRow(r: ExhibitPlanRow): ExhibitPlanItem {
  return {
    id: r.id,
    caseId: r.case_id,
    label: r.label,
    title: r.title,
    description: r.description ?? '',
    position: r.position,
    filledByExhibitId: r.filled_by_exhibit_id ?? null,
    createdAt: r.created_at,
  };
}

function profileFromRow(r: ProfileRow): Profile {
  return {
    id: r.id,
    displayName: r.display_name ?? null,
    role: r.role ?? null,
    organization: r.organization ?? null,
    avatarUrl: r.avatar_url ?? null,
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
    return {
      cases: parsed.cases ?? [],
      exhibits: parsed.exhibits ?? [],
      aiReviews: parsed.aiReviews ?? [],
      exhibitPlans: parsed.exhibitPlans ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { cases: [], exhibits: [], aiReviews: [], exhibitPlans: [] };
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
// Public API — dispatches on usingSupabase()
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
  jurisdiction: Jurisdiction;
  caseType: CaseType;
  description: string;
}): Promise<Case> {
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
        jurisdiction_country: input.jurisdiction.country,
        jurisdiction_state: input.jurisdiction.state ?? null,
        jurisdiction_city: input.jurisdiction.city ?? null,
        case_type: input.caseType,
        description: input.description,
        status: 'draft',
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
    jurisdiction: input.jurisdiction,
    caseType: input.caseType,
    description: input.description,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  db.cases.push(c);
  await writeLocalDB(db);
  return c;
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
  planItemId?: string | null;
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

    if (input.planItemId) {
      await supabase
        .from('exhibit_plans')
        .update({ filled_by_exhibit_id: id })
        .eq('id', input.planItemId);
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
  if (input.planItemId) {
    const plan = db.exhibitPlans.find((p) => p.id === input.planItemId);
    if (plan) plan.filledByExhibitId = id;
  }
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
 * (local mode — the file route reads from disk directly).
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
// Exhibit plans (A–Z suggested exhibit slots)
// ---------------------------------------------------------------------------

export async function listExhibitPlans(caseId: string): Promise<ExhibitPlanItem[]> {
  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) return [];
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('exhibit_plans')
      .select('*')
      .eq('case_id', caseId)
      .order('position', { ascending: true });
    if (error) throw error;
    return (data as ExhibitPlanRow[]).map(planItemFromRow);
  }
  const db = await readLocalDB();
  return db.exhibitPlans
    .filter((p) => p.caseId === caseId)
    .sort((a, b) => a.position - b.position);
}

export async function replaceExhibitPlans(
  caseId: string,
  items: { title: string; description: string }[],
): Promise<ExhibitPlanItem[]> {
  const now = new Date().toISOString();

  if (usingSupabase()) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in.');
    const supabase = createServerSupabase();

    await supabase.from('exhibit_plans').delete().eq('case_id', caseId);

    const rows = items.map((item, i) => ({
      case_id: caseId,
      user_id: user.id,
      label: `Exhibit ${labelFor(i)}`,
      title: item.title,
      description: item.description,
      position: i + 1,
    }));
    if (rows.length === 0) return [];
    const { data, error } = await supabase
      .from('exhibit_plans')
      .insert(rows)
      .select('*')
      .order('position', { ascending: true });
    if (error) throw error;
    return (data as ExhibitPlanRow[]).map(planItemFromRow);
  }

  const db = await readLocalDB();
  db.exhibitPlans = db.exhibitPlans.filter((p) => p.caseId !== caseId);
  const created: ExhibitPlanItem[] = items.map((item, i) => ({
    id: crypto.randomUUID(),
    caseId,
    label: `Exhibit ${labelFor(i)}`,
    title: item.title,
    description: item.description,
    position: i + 1,
    filledByExhibitId: null,
    createdAt: now,
  }));
  db.exhibitPlans.push(...created);
  await writeLocalDB(db);
  return created;
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

export async function upsertProfile(input: {
  displayName?: string | null;
  role?: string | null;
  organization?: string | null;
  avatarUrl?: string | null;
}): Promise<Profile> {
  if (!usingSupabase()) throw new Error('Profiles require Supabase to be configured.');
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      display_name: input.displayName ?? null,
      role: input.role ?? null,
      organization: input.organization ?? null,
      avatar_url: input.avatarUrl ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return profileFromRow(data as ProfileRow);
}
