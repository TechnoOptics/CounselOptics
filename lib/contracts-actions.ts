'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerIsFirmMember } from './firm-authz';
import { safeStorageUpload } from './upload-safety';
import { getContractType } from './contract-types';

/**
 * Where a contract's file lives, keyed by whoever owns the contract: a firm id
 * under firm-documents, a user id under user-vault. Built here and validated
 * here, off one definition, so the layout an upload creates and the layout a
 * later read insists on cannot drift apart.
 */
function contractPrefix(ownerId: string): string {
  return `${ownerId}/contracts/`;
}

/**
 * A stored `file_path` may be handed to the SERVICE-ROLE client only when it
 * sits inside its own owner's prefix.
 *
 * `user_contracts.file_path` is a plain column. Nothing in the row policy
 * constrains it, so its value is whatever was stored there, and every export of
 * this module is a public HTTP endpoint reachable with arguments of the
 * caller's choosing. A row the caller is entitled to therefore proves nothing
 * about the file it names.
 *
 * Rejects, never rewrites: a path that does not match is either a bug here or
 * somebody reaching for a file that is not theirs, and repointing it at
 * something harmless would hide both.
 */
function isContractPath(ownerId: string, path: string | null | undefined): boolean {
  if (!ownerId || !path) return false;
  // A traversal segment would let a matching prefix still resolve elsewhere.
  if (path.includes('..')) return false;
  return path.startsWith(contractPrefix(ownerId));
}

/**
 * Upload + register a contract in the user's repository (consumer)
 * or the firm's repository (counsel mode). Files land in the
 * firm-documents bucket (firm side) or user-vault bucket (consumer
 * side); the row in user_contracts holds the metadata + later
 * Bella review.
 */
export async function uploadContractAction(
  formData: FormData,
  options: { firmId?: string | null } = {},
): Promise<{ ok: boolean; error?: string; contractId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  // `firmId` is an argument, so it is the caller's to choose, and the firm
  // branch below writes into that firm's prefix. The check belongs HERE, above
  // every byte: an upload that lands and is checked afterwards has already put
  // a file in someone else's repository, which is the same defect class as a
  // delete that wipes storage and then checks.
  if (options.firmId && !(await callerIsFirmMember(options.firmId))) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }

  const file = formData.get('file');
  const name = String(formData.get('name') ?? '').trim();
  const contractType = String(formData.get('contractType') ?? '').trim();
  const customType = String(formData.get('customType') ?? '').trim() || null;
  const partiesRaw = String(formData.get('parties') ?? '').trim();
  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const tagsRaw = String(formData.get('tags') ?? '').trim();
  const signedAt = String(formData.get('signedAt') ?? '').trim() || null;
  const expiryAt = String(formData.get('expiryAt') ?? '').trim() || null;

  if (!contractType || (contractType === 'other' && !customType)) {
    return { ok: false, error: 'Pick a contract type (or specify a custom one).' };
  }
  if (contractType !== 'other' && !getContractType(contractType)) {
    return { ok: false, error: 'Unknown contract type.' };
  }

  const parties = partiesRaw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tags = tagsRaw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let filePath: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;
  let displayName = name;

  // File is optional - the user may want to record a contract they
  // signed in person and just keep metadata. When provided, upload
  // to the appropriate bucket.
  if (file instanceof File && file.size > 0) {
    if (file.size > 50 * 1024 * 1024) {
      return { ok: false, error: 'File is over the 50 MB limit.' };
    }
    if (!displayName) displayName = file.name;
    mimeType = file.type || 'application/octet-stream';
    fileSize = file.size;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_ ]/g, '').slice(0, 100);
    const id = crypto.randomUUID();
    if (options.firmId) {
      filePath = `${contractPrefix(options.firmId)}${id}/${safeName}`;
      const supabase = createServerSupabase();
      const buffer = Buffer.from(await file.arrayBuffer());
      // Central chokepoint: magic-byte + dangerous-content screen.
      const uploaded = await safeStorageUpload({
        client: supabase,
        bucket: 'firm-documents',
        path: filePath,
        buffer,
        declaredMime: mimeType,
        maxBytes: 50 * 1024 * 1024,
      });
      if (!uploaded.ok) return { ok: false, error: uploaded.error };
    } else {
      filePath = `${contractPrefix(user.id)}${id}/${safeName}`;
      const admin = createAdminSupabase();
      if (!admin) return { ok: false, error: 'Service role not configured.' };
      const buffer = Buffer.from(await file.arrayBuffer());
      const uploaded = await safeStorageUpload({
        client: admin,
        bucket: 'user-vault',
        path: filePath,
        buffer,
        declaredMime: mimeType,
        maxBytes: 50 * 1024 * 1024,
      });
      if (!uploaded.ok) {
        // Bucket may not exist yet on first run; degrade gracefully. Any
        // other error (incl. a rejected file) surfaces to the user.
        if (uploaded.error.toLowerCase().includes('bucket')) {
          filePath = null;
        } else {
          return { ok: false, error: uploaded.error };
        }
      }
    }
  }
  if (!displayName) {
    return { ok: false, error: 'Give the contract a name.' };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('user_contracts')
    .insert({
      user_id: options.firmId ? null : user.id,
      firm_id: options.firmId ?? null,
      name: displayName,
      contract_type: contractType,
      custom_type: customType,
      parties,
      jurisdiction,
      signed_at: signedAt,
      expiry_at: expiryAt,
      file_path: filePath,
      mime_type: mimeType,
      file_size: fileSize,
      notes,
      tags,
      status: 'stored',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  revalidatePath(options.firmId ? '/counsel/contracts' : '/contracts');
  return { ok: true, contractId: (data as { id: string }).id };
}

/**
 * Run Bella review on a stored contract. Pulls the contract bytes
 * (when present) plus metadata, asks Claude for a summary +
 * confidence + pros / cons / suggestions, persists the result on
 * the row.
 *
 * The review is intentionally NOT legal advice. The persisted text
 * always carries the standard "draft, not legal advice" framing -
 * we ship the AI signal, not a legal opinion.
 */
export async function reviewContractAction(
  contractId: string,
): Promise<{
  ok: boolean;
  error?: string;
  summary?: string;
  confidence?: number;
  pros?: string[];
  cons?: string[];
  suggestions?: string[];
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: row } = await supabase
    .from('user_contracts')
    .select(
      'id, user_id, firm_id, name, contract_type, custom_type, parties, jurisdiction, file_path, notes, tags',
    )
    .eq('id', contractId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Contract not found.' };
  const contract = row as {
    id: string;
    user_id: string | null;
    firm_id: string | null;
    name: string;
    contract_type: string;
    custom_type: string | null;
    parties: string[];
    jurisdiction: string | null;
    file_path: string | null;
    notes: string | null;
    tags: string[];
  };

  // The read above went through RLS, which is not the gate that matters here:
  // the download below runs on the service role, which bypasses RLS entirely.
  // State the entitlement in the action, on the one firm axis this codebase
  // has, and separately for a contract a person owns themselves.
  if (contract.firm_id) {
    if (!(await callerIsFirmMember(contract.firm_id))) {
      return { ok: false, error: 'You do not have access to this firm.' };
    }
  } else if (!contract.user_id || contract.user_id !== user.id) {
    return { ok: false, error: 'Contract not found.' };
  }
  const owner = contract.firm_id ?? contract.user_id ?? '';

  // Pull the file body for review when available.
  let bodyText = '';
  if (contract.file_path) {
    // Entitlement to the ROW is not entitlement to whatever path the row
    // happens to name. Refuse outright rather than quietly reviewing the
    // metadata alone, which would hide the mismatch from everyone.
    if (!isContractPath(owner, contract.file_path)) {
      return { ok: false, error: 'That file does not belong to this contract.' };
    }
    const admin = createAdminSupabase();
    if (admin) {
      const bucket = contract.firm_id ? 'firm-documents' : 'user-vault';
      try {
        const dl = await admin.storage.from(bucket).download(contract.file_path);
        if (dl.data) {
          const buf = Buffer.from(await dl.data.arrayBuffer());
          // For text-like mimes, decode directly. For PDFs we'd
          // ideally call pdf-parse here; that's a follow-up.
          bodyText = buf.toString('utf8').slice(0, 100_000);
        }
      } catch {
        /* fall through to metadata-only review */
      }
    }
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: 'Bella is not configured (no API key).' };
  const client = new Anthropic({ apiKey });

  const meta = [
    `Type: ${contract.custom_type ?? contract.contract_type}`,
    contract.jurisdiction ? `Jurisdiction: ${contract.jurisdiction}` : null,
    contract.parties.length > 0 ? `Parties: ${contract.parties.join(', ')}` : null,
    contract.tags.length > 0 ? `Tags: ${contract.tags.join(', ')}` : null,
    contract.notes ? `Notes: ${contract.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const userPrompt = `Review the contract below. Return a structured assessment.

Metadata:
${meta || '(no metadata)'}

Document body (may be partial or empty if the file was binary):
${bodyText.slice(0, 80_000)}

Return JSON with this exact shape:
{
  "summary": "2-3 sentence plain-English summary of what this document does and who it favors.",
  "confidence": 0-100,
  "pros": ["bullet", "bullet", ...],
  "cons": ["bullet", "bullet", ...],
  "suggestions": ["concrete edit", "concrete edit", ...]
}

Confidence rules:
- 90-100: very standard / boilerplate, low risk
- 70-89: workable but with carve-outs to negotiate
- 50-69: meaningful issues; user should push back
- 25-49: significant red flags; recommend not signing as-is
- 0-24: walk away or get an attorney

Tone: concrete, plain English, no hedging language. Do NOT claim
this is legal advice.`;

  let modelOutput: string;
  let modelName = 'claude-sonnet-4-5-20251022';
  try {
    const resp = await client.messages.create({
      model: modelName,
      max_tokens: 1500,
      system:
        'You review contracts and return structured JSON only. No prose outside the JSON. You are not the user\'s attorney; flag this when relevant in the summary.',
      messages: [{ role: 'user', content: userPrompt }],
    });
    const textBlock = resp.content.find((b) => b.type === 'text');
    modelOutput = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    if (resp.model) modelName = resp.model;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Bella errored.' };
  }

  // Extract the JSON envelope (Claude sometimes wraps in markdown).
  const jsonMatch = modelOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, error: 'Bella returned non-JSON.' };
  }
  let parsed: {
    summary?: string;
    confidence?: number;
    pros?: string[];
    cons?: string[];
    suggestions?: string[];
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false, error: 'Bella returned malformed JSON.' };
  }

  const summary = String(parsed.summary ?? '').trim();
  const confidence = Math.min(
    100,
    Math.max(0, Math.round(Number(parsed.confidence ?? 50))),
  );
  const pros = Array.isArray(parsed.pros) ? parsed.pros.map(String) : [];
  const cons = Array.isArray(parsed.cons) ? parsed.cons.map(String) : [];
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.map(String)
    : [];

  const { data: saved, error: saveErr } = await supabase
    .from('user_contracts')
    .update({
      review_summary: summary,
      review_confidence: confidence,
      review_pros: pros,
      review_cons: cons,
      review_suggestions: suggestions,
      reviewed_at: new Date().toISOString(),
      reviewed_model: modelName,
      status: 'reviewed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractId)
    .select('id');
  if (saveErr) return { ok: false, error: saveErr.message };
  // An update that matched no rows comes back clean from PostgREST. Handing
  // the caller a review that was never stored would have them read it once and
  // find it gone on the next page load.
  if (!saved || saved.length === 0) {
    return { ok: false, error: 'The review could not be saved to this contract.' };
  }

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath(`/counsel/contracts/${contractId}`);
  return { ok: true, summary, confidence, pros, cons, suggestions };
}

export async function deleteContractAction(
  contractId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  // The delete used to carry an id and nothing else, leaving the row policy as
  // the only thing standing between a posted id and someone else's contract.
  // Name who the row belongs to, and say so here in the action.
  const { data: found } = await supabase
    .from('user_contracts')
    .select('id, user_id, firm_id')
    .eq('id', contractId)
    .maybeSingle();
  const row = found as { id: string; user_id: string | null; firm_id: string | null } | null;
  if (!row) return { ok: false, error: 'Contract not found.' };
  if (row.firm_id) {
    if (!(await callerIsFirmMember(row.firm_id))) {
      return { ok: false, error: 'You do not have access to this firm.' };
    }
  } else if (!row.user_id || row.user_id !== user.id) {
    return { ok: false, error: 'Contract not found.' };
  }
  const { data: deleted, error } = await supabase
    .from('user_contracts')
    .delete()
    .eq('id', contractId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // PostgREST calls a delete that matched nothing a success, so an empty
  // result is the refusal and the caller has to be told.
  if (!deleted || deleted.length === 0) {
    return { ok: false, error: 'That contract could not be deleted.' };
  }
  revalidatePath('/contracts');
  revalidatePath('/counsel/contracts');
  return { ok: true };
}
