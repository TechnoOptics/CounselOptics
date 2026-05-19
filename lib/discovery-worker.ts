'use server';

import { revalidatePath } from 'next/cache';
import { createAdminSupabase } from './supabase/admin';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { scanDocument } from './discovery';

/**
 * In-process discovery worker. Real production version lives in a
 * background queue (Inngest, QStash) - that's roadmap Tier 2 #7.
 * For v1, this runs synchronously inside the request handler:
 *   - safe up to ~50 small text documents per call
 *   - text extraction is a no-op for now (we use stored
 *     description / name fields); PDF text extraction comes with
 *     pdf-parse in a follow-up
 *
 * The classifier (lib/discovery.ts:scanDocument) is pure and
 * reusable. The worker just walks the documents and persists
 * findings.
 */
export async function runDiscoveryJobAction(
  jobId: string,
): Promise<{ ok: boolean; error?: string; processed?: number; findings?: number }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is not fully configured.' };

  const supabase = createServerSupabase();
  const { data: jobRow } = await supabase
    .from('discovery_jobs')
    .select('id, firm_id, case_id, status')
    .eq('id', jobId)
    .maybeSingle();
  if (!jobRow) return { ok: false, error: 'Job not found.' };
  const job = jobRow as {
    id: string;
    firm_id: string;
    case_id: string | null;
    status: string;
  };
  if (job.status === 'running') {
    return { ok: false, error: 'Job is already running.' };
  }

  await admin
    .from('discovery_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id);

  // Pull the documents linked to the case (or all firm documents
  // tagged 'discovery' when no case is set). Cap at 50 per pass.
  let docsQuery = admin
    .from('firm_documents')
    .select('id, name, description, tags, file_path, mime_type')
    .eq('firm_id', job.firm_id)
    .limit(50);
  if (job.case_id) docsQuery = docsQuery.eq('case_id', job.case_id);
  else docsQuery = docsQuery.contains('tags', ['discovery']);
  const { data: docsRaw } = await docsQuery;
  const docs = (docsRaw ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    tags: string[] | null;
    file_path: string;
    mime_type: string;
  }>;

  // Pull attorney + executive name lists for the classifier so
  // attorney-client privilege + executive-mention heuristics fire.
  const [{ data: members }, { data: clients }] = await Promise.all([
    admin
      .from('firm_members')
      .select('user_id, display_name')
      .eq('firm_id', job.firm_id),
    admin
      .from('firm_clients')
      .select('display_name')
      .eq('firm_id', job.firm_id),
  ]);
  // firm_members has NO email column - the address lives on the auth
  // user. Resolve each member's email via the admin auth API so the
  // classifier's privilege + mention heuristics can still match
  // attorney email addresses appearing in documents. Each lookup is
  // isolated so one failure can't break the batch.
  const memberRows = (members ?? []) as Array<{
    user_id: string;
    display_name: string | null;
  }>;
  const memberEmails = await Promise.all(
    memberRows.map(async (m) => {
      try {
        const { data: au } = await admin.auth.admin.getUserById(m.user_id);
        return au?.user?.email ?? null;
      } catch {
        return null;
      }
    }),
  );
  const attorneyNames = memberRows
    .flatMap((m, i) => [m.display_name, memberEmails[i]].filter(Boolean) as string[])
    .map(String);
  const executiveNames = ((clients ?? []) as Array<{
    display_name: string | null;
  }>)
    .map((c) => c.display_name)
    .filter((s): s is string => Boolean(s));

  let processed = 0;
  let findingsCount = 0;
  let privilegedCount = 0;
  let hotCount = 0;

  for (const d of docs) {
    // Text source: description first (cheaper); when present we use
    // it. Real PDF text extraction lives in the follow-up commit
    // that wires pdf-parse. The name + tags also feed the scanner
    // as a fallback signal.
    const text = [d.name, d.description ?? '', (d.tags ?? []).join(' ')]
      .filter(Boolean)
      .join('\n\n');
    const result = scanDocument(text, {
      attorneyNames,
      executiveNames,
      hotDollarThreshold: 100_000,
    });
    processed += 1;
    if (result.flags.length === 0 && !result.privileged && !result.hot) continue;

    findingsCount += 1;
    if (result.privileged) privilegedCount += 1;
    if (result.hot) hotCount += 1;

    await admin.from('discovery_findings').insert({
      job_id: job.id,
      document_id: d.id,
      document_path: d.file_path,
      flags: result.flags,
      severity: result.severity,
      privileged: result.privileged,
      hot: result.hot,
      summary: result.summary,
    });
  }

  await admin
    .from('discovery_jobs')
    .update({
      status: 'complete',
      processed_documents: processed,
      privileged_count: privilegedCount,
      hot_count: hotCount,
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  revalidatePath('/counsel');
  if (job.case_id) revalidatePath(`/counsel/cases/${job.case_id}`);
  return { ok: true, processed, findings: findingsCount };
}
