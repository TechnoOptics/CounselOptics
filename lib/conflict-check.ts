'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Conflict check + matter intake.
 *
 * Workflow:
 *   1. firm member creates a draft intake with client + opposing
 *      parties + matter type
 *   2. runConflictCheck() searches:
 *        - firm_clients for any prior representation (party = our
 *          existing client)
 *        - prior firm_matter_intakes opposing_parties (party was on
 *          the other side of a prior matter)
 *        - related_parties on prior matters
 *   3. results get stored as conflict_results JSON. Status flips to
 *      conflict_check_passed (no hits) or conflict_check_flagged
 *      (one or more hits with severity)
 *   4. cleared intakes can be promoted to a real matter (case row +
 *      engagement letter prefilled by Bella).
 *
 * The check is a name-based fuzzy match on every party. False
 * positives are expected (common names) and operators clear them
 * with a written waiver in conflict_check_notes - the audit trail
 * stays.
 */

export type ConflictHit = {
  source: 'existing_client' | 'prior_opposing' | 'prior_related';
  matchedParty: string;
  matchedAgainst: string;
  evidenceId: string;
  evidenceType: 'firm_client' | 'matter_intake';
  severity: 'low' | 'medium' | 'high';
};

export async function createMatterIntakeAction(
  firmId: string,
  input: {
    clientName: string;
    clientEmail?: string | null;
    clientPhone?: string | null;
    clientAddress?: string | null;
    matterType?: string | null;
    matterSummary?: string | null;
    jurisdictionState?: string | null;
    opposingParties?: string[];
    relatedParties?: string[];
    intakeAnswers?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; error?: string; intakeId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const row = {
    firm_id: firmId,
    client_name: input.clientName.trim(),
    client_email: input.clientEmail?.trim().toLowerCase() ?? null,
    client_phone: input.clientPhone?.trim() ?? null,
    client_address: input.clientAddress?.trim() ?? null,
    matter_type: input.matterType ?? null,
    matter_summary: input.matterSummary ?? null,
    jurisdiction_state: input.jurisdictionState ?? null,
    opposing_parties: input.opposingParties ?? [],
    related_parties: input.relatedParties ?? [],
    intake_answers: input.intakeAnswers ?? {},
    created_by: user.id,
    status: 'in_progress',
  };
  const supabase = createServerSupabase();
  let { data, error } = await supabase
    .from('firm_matter_intakes')
    .insert(row)
    .select('id')
    .single();

  // Employees of an enterprise tenant are NOT firm_members, so the
  // RLS insert policy (legal-team only) rejects their portal request
  // with "new row violates row-level security policy". They are still
  // allowed to file - the portal is built for exactly this - so when
  // the user client is blocked, verify the caller is a genuine active
  // employee of THIS firm and insert via the service-role client,
  // scoped to (firm_id, created_by = me) so it can't be abused.
  if (
    error &&
    /row-level security|violates row-level/i.test(error.message ?? '')
  ) {
    const admin = createAdminSupabase();
    if (admin) {
      // Enforce the request-creation entitlement server-side - the
      // portal hides "New request" for roles without it, but that is
      // UI only. A view-only employee must not be able to file by
      // calling this action directly.
      const { authorizeFirmActor } = await import('./portal-entitlements');
      const auth = await authorizeFirmActor(
        admin,
        firmId,
        user.id,
        'requests.create',
      );
      if (!auth.ok) return { ok: false, error: auth.error };
      const retry = await admin
        .from('firm_matter_intakes')
        .insert(row)
        .select('id')
        .single();
      data = retry.data;
      error = retry.error;
    }
  }
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  revalidatePath('/counsel/intake');
  revalidatePath('/portal');
  return { ok: true, intakeId: (data as { id: string }).id };
}

/**
 * Search firm_clients + prior matter intakes for any name match.
 * Uses Postgres ilike for substring matching on each party. The
 * normalize step strips punctuation + lowercases so "ACME, Inc." and
 * "acme inc" both match.
 */
export async function runConflictCheckAction(
  firmId: string,
  intakeId: string,
): Promise<{ ok: boolean; error?: string; hits?: ConflictHit[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();

  const { data: intake } = await supabase
    .from('firm_matter_intakes')
    .select(
      'id, firm_id, client_name, opposing_parties, related_parties, status',
    )
    .eq('id', intakeId)
    .maybeSingle();
  if (!intake) return { ok: false, error: 'Intake not found.' };
  const i = intake as {
    id: string;
    firm_id: string;
    client_name: string;
    opposing_parties: string[];
    related_parties: string[];
  };
  if (i.firm_id !== firmId) return { ok: false, error: 'Wrong firm.' };

  const allParties = [
    i.client_name,
    ...(i.opposing_parties ?? []),
    ...(i.related_parties ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  const hits: ConflictHit[] = [];

  // 1. Existing clients (firm_clients references profiles which has display_name).
  // We do an OR-match on every party against the firm's existing client list.
  const { data: existingClients } = await supabase
    .from('firm_clients')
    .select('id, user_id, display_name, email')
    .eq('firm_id', firmId);
  const clientList = (existingClients ?? []) as Array<{
    id: string;
    user_id: string;
    display_name: string | null;
    email: string | null;
  }>;
  for (const party of allParties) {
    const norm = normalizeName(party);
    for (const c of clientList) {
      const nameMatch =
        c.display_name && normalizeName(c.display_name).includes(norm);
      const emailMatch =
        c.email && c.email.toLowerCase().includes(norm.toLowerCase());
      if (nameMatch || emailMatch) {
        hits.push({
          source: 'existing_client',
          matchedParty: party,
          matchedAgainst: c.display_name ?? c.email ?? c.id,
          evidenceId: c.id,
          evidenceType: 'firm_client',
          severity:
            party === i.client_name
              ? 'low'
              : 'high',
        });
      }
    }
  }

  // 2. Prior matter intakes - opposing or related parties.
  const { data: priorIntakes } = await supabase
    .from('firm_matter_intakes')
    .select('id, client_name, opposing_parties, related_parties, matter_type')
    .eq('firm_id', firmId)
    .neq('id', intakeId);
  const prior = (priorIntakes ?? []) as Array<{
    id: string;
    client_name: string;
    opposing_parties: string[];
    related_parties: string[];
    matter_type: string | null;
  }>;
  for (const party of allParties) {
    const norm = normalizeName(party);
    for (const p of prior) {
      const inOpposing = (p.opposing_parties ?? []).some((q) =>
        normalizeName(q).includes(norm) || norm.includes(normalizeName(q)),
      );
      const inRelated = (p.related_parties ?? []).some((q) =>
        normalizeName(q).includes(norm) || norm.includes(normalizeName(q)),
      );
      if (inOpposing) {
        hits.push({
          source: 'prior_opposing',
          matchedParty: party,
          matchedAgainst: p.client_name,
          evidenceId: p.id,
          evidenceType: 'matter_intake',
          severity: 'high',
        });
      } else if (inRelated) {
        hits.push({
          source: 'prior_related',
          matchedParty: party,
          matchedAgainst: p.client_name,
          evidenceId: p.id,
          evidenceType: 'matter_intake',
          severity: 'medium',
        });
      }
    }
  }

  // Persist the result.
  const status = hits.length > 0 ? 'conflict_check_flagged' : 'conflict_check_passed';
  await supabase
    .from('firm_matter_intakes')
    .update({
      status,
      conflict_results: hits,
      updated_at: new Date().toISOString(),
    })
    .eq('id', intakeId);

  revalidatePath(`/counsel/intake/${intakeId}`);
  return { ok: true, hits };
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function clearConflictAction(
  firmId: string,
  intakeId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (reason.trim().length < 10) {
    return {
      ok: false,
      error:
        'Please record a written reason (at least 10 characters) for the audit trail.',
    };
  }
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('firm_matter_intakes')
    .update({
      status: 'conflict_check_passed',
      conflict_check_notes: reason.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', intakeId)
    .eq('firm_id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/intake/${intakeId}`);
  return { ok: true };
}
