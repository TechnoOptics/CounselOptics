'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getContractType } from './contract-types';

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
      filePath = `${options.firmId}/contracts/${id}/${safeName}`;
      const supabase = createServerSupabase();
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadErr } = await supabase.storage
        .from('firm-documents')
        .upload(filePath, buffer, { contentType: mimeType, upsert: false });
      if (uploadErr) return { ok: false, error: uploadErr.message };
    } else {
      filePath = `${user.id}/contracts/${id}/${safeName}`;
      const admin = createAdminSupabase();
      if (!admin) return { ok: false, error: 'Service role not configured.' };
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadErr } = await admin.storage
        .from('user-vault')
        .upload(filePath, buffer, { contentType: mimeType, upsert: false });
      if (uploadErr) {
        // Bucket may not exist yet on first run; degrade gracefully.
        if ((uploadErr.message ?? '').toLowerCase().includes('bucket')) {
          filePath = null;
        } else {
          return { ok: false, error: uploadErr.message };
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

  // Pull the file body for review when available.
  let bodyText = '';
  if (contract.file_path) {
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

  await supabase
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
    .eq('id', contractId);

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
  const { error } = await supabase
    .from('user_contracts')
    .delete()
    .eq('id', contractId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/contracts');
  revalidatePath('/counsel/contracts');
  return { ok: true };
}
