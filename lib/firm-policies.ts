'use server';

import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { authorizeFirmActor } from './portal-entitlements';
import { bellaGenerate } from './bella';
import { AiUnavailableError } from './ai-errors';
import { checkRateLimit } from './rate-limit';
import { extractFileText } from './doc-review';
import { analyzeImage } from './timeline-ai';

/**
 * Firm policy library + the employee "Check a document" tool.
 *
 * Legal uploads the company's policies once (paste or file text). Employees
 * then check a draft document or a question against those policies and get a
 * confidence score with the specific passages legal has said no to, flagged, as
 * self-service research that keeps routine "can I do this?" tickets out of
 * the intake queue. The verdict is explicitly NOT legal advice; the closing
 * line always points to filing a request when in doubt.
 *
 * firm_policies carries RLS with no policies: service-role only, gated here.
 */

export type FirmPolicy = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
};

export type PolicyCheckFlag = {
  level: 'blocked' | 'caution' | 'ok';
  quote: string;
  policy: string;
  note: string;
};

export type PolicyCheckResult = {
  score: number; // 0-100 confidence the document/question is within policy
  verdict: string; // one-paragraph plain-language read
  flags: PolicyCheckFlag[];
};

const AUTHOR_ROLES = new Set(['owner', 'admin', 'attorney', 'paralegal']);

async function requireAuthor(firmId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in first.' as const };
  const admin = createAdminSupabase();
  if (!admin) return { error: 'Service unavailable.' as const };
  const { data } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (data as { role: string } | null)?.role;
  if (!role || !AUTHOR_ROLES.has(role)) return { error: 'No access to this firm.' as const };
  return { user, admin };
}

export async function saveFirmPolicyAction(
  firmId: string,
  input: { id?: string; name: string; content: string },
): Promise<{ ok: boolean; error?: string; policy?: FirmPolicy }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const name = input.name.trim().slice(0, 120);
  const content = input.content.trim().slice(0, 200000);
  if (!name || !content) return { ok: false, error: 'Give the policy a name and its text.' };
  const q = input.id
    ? gate.admin
        .from('firm_policies')
        .update({ name, content, updated_at: new Date().toISOString() })
        .eq('id', input.id)
        .eq('firm_id', firmId)
        .select('id, name, content, created_at')
        .single()
    : gate.admin
        .from('firm_policies')
        .insert({ firm_id: firmId, name, content, created_by: gate.user.id })
        .select('id, name, content, created_at')
        .single();
  const { data, error } = await q;
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the policy.' };
  const r = data as { id: string; name: string; content: string; created_at: string };
  return { ok: true, policy: { id: r.id, name: r.name, content: r.content, createdAt: r.created_at } };
}

export async function deleteFirmPolicyAction(
  firmId: string,
  policyId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const { error } = await gate.admin.from('firm_policies').delete().eq('id', policyId).eq('firm_id', firmId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function listFirmPoliciesAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string; policies?: FirmPolicy[] }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const { data, error } = await gate.admin
    .from('firm_policies')
    .select('id, name, content, created_at')
    .eq('firm_id', firmId)
    .order('name');
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    policies: ((data ?? []) as { id: string; name: string; content: string; created_at: string }[]).map((r) => ({
      id: r.id,
      name: r.name,
      content: r.content,
      createdAt: r.created_at,
    })),
  };
}

/** Employee-facing: how many policies exist (to explain an empty state). */
export async function portalPolicyCountAction(
  firmId: string,
): Promise<{ ok: boolean; count: number }> {
  const user = await getCurrentUser();
  const admin = createAdminSupabase();
  if (!user || !admin) return { ok: false, count: 0 };
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.view');
  if (!actor.ok) return { ok: false, count: 0 };
  const { count } = await admin
    .from('firm_policies')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId);
  return { ok: true, count: count ?? 0 };
}

const MAX_POLICY_CHARS = 60000;
const MAX_DOC_CHARS = 40000;

/**
 * The check itself. Employee-gated; per-user rate limited; policies are
 * concatenated (capped) and the model must answer in strict JSON.
 */
export async function checkAgainstPoliciesAction(
  firmId: string,
  input: { text: string; label?: string },
): Promise<{ ok: boolean; error?: string; result?: PolicyCheckResult }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.view');
  if (!actor.ok) return { ok: false, error: 'No access.' };
  const allowed = await checkRateLimit(`policy-check:${user.id}`, { limit: 20, windowSeconds: 3600 });
  if (!allowed) return { ok: false, error: 'You have reached the hourly check limit. Try again later.' };

  const text = input.text.trim().slice(0, MAX_DOC_CHARS);
  if (text.length < 20) return { ok: false, error: 'Paste a document or a question first (at least a sentence).' };

  const { data } = await admin
    .from('firm_policies')
    .select('name, content')
    .eq('firm_id', firmId)
    .order('name');
  const policies = (data ?? []) as { name: string; content: string }[];
  if (policies.length === 0) {
    return { ok: false, error: 'Your legal team has not uploaded any policies yet. File a request instead.' };
  }

  let corpus = '';
  for (const p of policies) {
    const chunk = `\n\n### POLICY: ${p.name}\n${p.content}`;
    if (corpus.length + chunk.length > MAX_POLICY_CHARS) break;
    corpus += chunk;
  }

  const system =
    'You are a meticulous in-house compliance analyst. You compare an employee\'s document or question against the company\'s written policies and answer ONLY with strict JSON matching: {"score": number 0-100, "verdict": string, "flags": [{"level": "blocked"|"caution"|"ok", "quote": string, "policy": string, "note": string}]}. "score" is your confidence the submission is within policy (100 = clearly fine). "flags" quote the specific passage of the SUBMISSION (short excerpt), name the policy it touches, and explain plainly. Use level "blocked" for things the policies prohibit, "caution" for things needing legal review or conditions, "ok" for notable passages that are explicitly permitted. Never invent policy text. If the policies do not address the submission, say so in the verdict and keep flags empty. The verdict must end by reminding the employee this is a policy comparison, not legal advice, and to file a request with legal when unsure.';

  const prompt = `COMPANY POLICIES:${corpus}\n\n---\n\nEMPLOYEE SUBMISSION${input.label ? ` (${input.label.slice(0, 80)})` : ''}:\n${text}\n\nReturn the JSON now.`;

  try {
    const raw = await bellaGenerate({ system, prompt, maxTokens: 2000 });
    const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonText) as PolicyCheckResult;
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    const flags = (Array.isArray(parsed.flags) ? parsed.flags : [])
      .slice(0, 20)
      .map((f) => ({
        level: f.level === 'blocked' || f.level === 'ok' ? f.level : ('caution' as const),
        quote: String(f.quote ?? '').slice(0, 500),
        policy: String(f.policy ?? '').slice(0, 120),
        note: String(f.note ?? '').slice(0, 600),
      }));
    return {
      ok: true,
      result: { score, verdict: String(parsed.verdict ?? '').slice(0, 2000), flags },
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof AiUnavailableError
          ? 'The checker is temporarily unavailable. Please try again shortly, or file a request.'
          : 'Could not complete the check. Try again, or file a request with legal.',
    };
  }
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Turn an uploaded document into text for the policy check. PDF, Word
 * (.docx), text/markdown, and spreadsheets go through extractFileText;
 * PNG/JPEG/WebP photos (including iPhone photos, which iOS converts from
 * HEIC to JPEG on upload) are read with OCR. Employee-gated + rate limited
 * alongside the check itself.
 */
export async function extractCheckTextAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; text?: string; kind?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.view');
  if (!actor.ok) return { ok: false, error: 'No access.' };
  const allowed = await checkRateLimit(`policy-extract:${user.id}`, { limit: 30, windowSeconds: 3600 });
  if (!allowed) return { ok: false, error: 'Too many uploads this hour. Try again later.' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Attach a file first.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'That file is over 10 MB. Try a smaller file or paste the text.' };

  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (mime.includes('heic') || mime.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif')) {
    return { ok: false, error: 'This photo is in HEIC format. Share it from Photos (which converts it to JPEG) or screenshot it, then upload again.' };
  }

  if (IMAGE_MIMES.has(mime) || /\.(png|jpe?g|webp|gif)$/.test(name)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const res = await analyzeImage({
      buffer,
      mime: mime || 'image/jpeg',
      userContext: 'Transcribe every word of text visible in this document photo, preserving reading order.',
      kind: 'photo',
    });
    if ('error' in res) return { ok: false, error: 'Could not read the photo. Try a clearer picture or paste the text.' };
    const text = (res.extracted.ocr_text ?? '').trim();
    if (text.length < 20) return { ok: false, error: 'No readable text found in the photo. Try a clearer picture.' };
    return { ok: true, text: text.slice(0, 40000), kind: 'image' };
  }

  const out = await extractFileText(file);
  if (out.error) return { ok: false, error: out.error };
  const text = out.text.trim();
  if (text.length < 20) return { ok: false, error: 'No readable text found in that file. Paste the text instead.' };
  return { ok: true, text: text.slice(0, 40000), kind: out.kind };
}
