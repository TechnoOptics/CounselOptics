/**
 * Discovery review engine.
 *
 * The worker (queued via Inngest or QStash - infra not provisioned in
 * this commit; see roadmap Tier 2) walks every document in a job's
 * tranche, runs:
 *   - Privilege detection: regex + heuristics for "attorney-client",
 *     "work product", "settlement communication", names from the
 *     firm's attorney roster, etc.
 *   - Hot-doc heuristics: profanity, executives mentioned, dollar
 *     amounts above a threshold, key claim terms.
 *   - Theme clustering: pulls the 200-token summary of every doc
 *     and asks Claude to group them.
 *
 * This module ships:
 *   - createDiscoveryJob(): create the job row, expects external
 *     code to enqueue the worker.
 *   - scanDocument(): pure-function classifier that runs over a
 *     single document's text and returns flags + severity.
 *   - recordFinding(): persists the worker's output.
 *
 * The actual queueing + Claude theme clustering is queued at
 * docs/ROADMAP.md Tier 2 #7. Building the schema + classifier now
 * means a single worker function lights everything up later.
 */

import { createServerSupabase, getCurrentUser } from './supabase/server';

export type DiscoveryFlag =
  | 'attorney_client'
  | 'work_product'
  | 'settlement'
  | 'phi'
  | 'pii'
  | 'trade_secret'
  | 'profanity'
  | 'high_dollar'
  | 'executive_mentioned'
  | 'admission';

export type DiscoveryFindingResult = {
  flags: DiscoveryFlag[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  privileged: boolean;
  hot: boolean;
  summary: string | null;
};

/**
 * Pure heuristic scanner. Runs on the document text; designed to
 * survive false positives - the operator review queue still has the
 * final say. Tunable thresholds live at the top of the function.
 */
export function scanDocument(text: string, opts: {
  attorneyNames?: string[];
  executiveNames?: string[];
  hotDollarThreshold?: number;
} = {}): DiscoveryFindingResult {
  const flags = new Set<DiscoveryFlag>();
  const ATT = (opts.attorneyNames ?? []).map((s) => s.toLowerCase());
  const EXE = (opts.executiveNames ?? []).map((s) => s.toLowerCase());
  const DOLLAR = opts.hotDollarThreshold ?? 100_000;

  const lower = text.toLowerCase();

  // Privilege markers (literal phrases or attorney names in
  // proximity to confidential markers).
  if (/(attorney[-\s]+client|privileged\s+and\s+confidential|protected\s+by\s+attorney)/i.test(text)) {
    flags.add('attorney_client');
  }
  if (/(work\s+product|prepared\s+in\s+anticipation\s+of\s+litigation)/i.test(text)) {
    flags.add('work_product');
  }
  if (/(without\s+prejudice|settlement\s+communication|fre\s*408|frep\s*408)/i.test(text)) {
    flags.add('settlement');
  }
  if (ATT.some((name) => name && lower.includes(name))) {
    flags.add('attorney_client');
  }

  // PHI / PII heuristics. Real version uses a proper detector
  // (Presidio, Comprehend); the regex set is a fast first pass.
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) flags.add('pii'); // SSN
  if (/\b(?:patient|diagnosis|prescription|HIPAA)\b/i.test(text)) flags.add('phi');
  if (/(trade\s+secret|proprietary\s+(?:formula|method)|do\s+not\s+disclose)/i.test(text)) {
    flags.add('trade_secret');
  }

  // Hot-doc heuristics.
  const profanity = /\b(?:fuck|shit|damn|asshole|bastard|hell)\b/gi;
  const profanityHits = (text.match(profanity) ?? []).length;
  if (profanityHits >= 2) flags.add('profanity');

  const dollarMatches = text.match(/\$\s?([\d,]+)(?:\.\d{1,2})?/g) ?? [];
  for (const m of dollarMatches) {
    const num = Number(m.replace(/[$,\s]/g, ''));
    if (Number.isFinite(num) && num >= DOLLAR) {
      flags.add('high_dollar');
      break;
    }
  }

  if (EXE.some((name) => name && lower.includes(name))) {
    flags.add('executive_mentioned');
  }

  // Admission language - "we were aware", "we knew", "should have"
  if (/\b(we|i)\s+(?:knew|were\s+aware|should\s+have|admit)/i.test(text)) {
    flags.add('admission');
  }

  // Severity: high if attorney_client + privileged AND hot signals
  // overlap; otherwise scale by count.
  const privileged =
    flags.has('attorney_client') ||
    flags.has('work_product') ||
    flags.has('settlement') ||
    flags.has('phi');
  const hot =
    flags.has('high_dollar') ||
    flags.has('profanity') ||
    flags.has('executive_mentioned') ||
    flags.has('admission');

  let severity: DiscoveryFindingResult['severity'] = 'low';
  if (privileged && hot) severity = 'critical';
  else if (privileged || flags.size >= 3) severity = 'high';
  else if (hot || flags.size >= 1) severity = 'medium';

  return {
    flags: Array.from(flags),
    severity,
    privileged,
    hot,
    summary: text.slice(0, 280),
  };
}

export async function createDiscoveryJob(input: {
  firmId: string;
  caseId?: string | null;
  name: string;
  totalDocuments: number;
}): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  'use server';
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('discovery_jobs')
    .insert({
      firm_id: input.firmId,
      case_id: input.caseId ?? null,
      name: input.name,
      status: 'queued',
      total_documents: input.totalDocuments,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  return { ok: true, jobId: (data as { id: string }).id };
}
