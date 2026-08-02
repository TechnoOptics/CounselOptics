'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import type { QuestionAnswer } from './intake-form-fallback';

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
 * The check is a normalized name match on every party (see namesMatch
 * below): lowercase + punctuation-stripped substring overlap in either
 * direction, plus reordered-token matching. It is deliberately
 * recall-oriented - false positives from common names are expected and
 * operators clear them with a written waiver in conflict_check_notes
 * (the audit trail stays). It is NOT phonetic or edit-distance fuzzy:
 * it will still miss typos ("Jon" vs "John") and nicknames ("Bob" vs
 * "Robert"), which is why a human still reviews every intake.
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
    /**
     * The `key` of the request type this was filed under. Only a hint, and
     * only used when `matterType` resolves to no type at all: the server works
     * the type out from `matterType` itself, so omitting this cannot switch
     * the form gate off.
     */
    requestTypeKey?: string | null;
    /** Answers to the built form, keyed by question `key`. */
    formAnswers?: Record<string, string | string[]> | null;
  },
): Promise<{
  ok: boolean;
  error?: string;
  intakeId?: string;
  /** Per question `key`, as `validateAnswers` returns them. */
  formErrors?: Record<string, string>;
  /**
   * The same failures carrying each question's label, for a caller reporting
   * them to a person rather than binding them to inputs. A `key` is a slug
   * frozen at publish time and can be unreadable.
   */
  formErrorQuestions?: Array<{ key: string; label: string }>;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  // A built form is enforced HERE, not in the browser. This module is
  // `'use server'`, so this function is a public HTTP endpoint and the client
  // could send any answers it liked; a rule evaluated only in the renderer is
  // not enforced. The payload validated against is the one the server reads
  // back for this firm and type, never one supplied by the caller.
  //
  // Which type this is gets DERIVED, from `matterType`, and only falls back to
  // the caller's `requestTypeKey` when that resolves to nothing. Keying the
  // gate off a field the caller chooses whether to send would leave the caller
  // holding the switch: omit it, and a mandatory form is skipped. `matterType`
  // cannot be omitted the same way, because it is the string that identifies
  // the request on every surface that reads it afterwards.
  //
  // The authorization check comes FIRST and is the shared one, so that reading
  // a firm's published questions is gated by the same rule as filing against
  // them. Without it, a caller passing someone else's firm id would be
  // rejected at the insert but would already have learned that firm's question
  // keys from the validation errors.
  //
  // It cannot block anyone who could file before: `authorizeFirmActor` admits
  // any `firm_members` row, and the live insert policy on
  // `firm_matter_intakes` admits only owner, admin, attorney and paralegal, so
  // it is a strict subset. Employees reach the same check below anyway.
  let formVersionId: string | null = null;
  let questionAnswers: QuestionAnswer[] = [];
  const admin = createAdminSupabase();
  if (admin) {
    const { authorizeFirmActor } = await import('./portal-entitlements');
    const auth = await authorizeFirmActor(admin, firmId, user.id, 'requests.create');
    if (!auth.ok) return { ok: false, error: auth.error };

    const { listPublishedPayloads, listRequestTypes } = await import('./form-queries');
    const { bindFormAnswers, resolveRequestTypeKey } = await import('./intake-form-fallback');

    // Every published form for the firm, rather than one type's, because the
    // tie break between two identically named types has to know which of them
    // actually gates anything. Same query count as fetching one payload, and
    // it is the map the binding then reads from.
    const [types, published] = await Promise.all([
      listRequestTypes(admin, firmId),
      listPublishedPayloads(admin, firmId),
    ]);

    // The caller's key is a tie break between two types a firm has renamed to
    // the same wording, and is the whole answer only when the label resolves
    // to nothing. Null means this intake names no request type this firm has:
    // a form hangs off a type row, so there is no form it could be dodging,
    // and it goes through as it always did.
    const typeKey =
      resolveRequestTypeKey(types, input.matterType, input.requestTypeKey, (key) =>
        Object.prototype.hasOwnProperty.call(published, key),
      ) ??
      input.requestTypeKey?.trim() ??
      null;

    if (typeKey) {
      const bound = bindFormAnswers(published[typeKey] ?? null, input.formAnswers);
      if (!bound.ok) {
        return {
          ok: false,
          error: 'Some answers still need attention.',
          formErrors: bound.errors,
          formErrorQuestions: bound.errorQuestions,
        };
      }
      questionAnswers = bound.questionAnswers;
      formVersionId = bound.formVersionId;
    }
  }

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
    // The server's `questionAnswers` are spread last, so where a form is
    // published the caller cannot pass its own labelled answers off as
    // validated ones. Where none is published, which is every firm today,
    // `intakeAnswers` is written as given and a caller-supplied
    // `questionAnswers` still rides through, exactly as it did before this
    // gate existed. Pre-existing, and unchanged here on purpose.
    //
    // The `{id, label, value}` shape is unchanged either way: the counsel
    // intake page reads exactly this, and intakes filed before the form
    // builder existed keep rendering.
    intake_answers: {
      ...(input.intakeAnswers ?? {}),
      ...(questionAnswers.length > 0 ? { questionAnswers } : {}),
    },
    created_by: user.id,
    status: 'in_progress',
    // Named only when there is a binding to record. An insert that never
    // mentions the column cannot fail anywhere the migration has not run, and
    // an absent binding and a null one mean the same thing.
    ...(formVersionId ? { form_version_id: formVersionId } : {}),
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
    // The same service-role client the form gate above resolved, rather than a
    // second one shadowing it.
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
 * Matching runs in application code via namesMatch(): normalized
 * (lowercase, punctuation-stripped) substring overlap in either
 * direction plus reordered-token matching, so "ACME, Inc." matches
 * "acme inc" and "Smith, John" matches "John Smith". Recall-oriented
 * by design; see the module docstring for what it deliberately does
 * not catch.
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
    for (const c of clientList) {
      const nameMatch = c.display_name && namesMatch(party, c.display_name);
      // Exact email match only when the party string is itself an email.
      const emailMatch =
        c.email &&
        party.includes('@') &&
        c.email.toLowerCase() === party.trim().toLowerCase();
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
    for (const p of prior) {
      const inOpposing = (p.opposing_parties ?? []).some((q) =>
        namesMatch(party, q),
      );
      const inRelated = (p.related_parties ?? []).some((q) =>
        namesMatch(party, q),
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

  // Partner-born tickets push the status change to the partner app.
  try {
    const { partnerTicketEvent } = await import('./partner-notify');
    await partnerTicketEvent(intakeId, 'ticket.status_changed');
  } catch {
    /* best-effort */
  }

  revalidatePath(`/counsel/intake/${intakeId}`);
  return { ok: true, hits };
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * True when two party names plausibly refer to the same entity.
 * Normalized, and recall-oriented on purpose:
 *   1. Substring overlap in either direction - "john smith" matches
 *      "john smith jr" and "acme" matches "acme inc".
 *   2. Reordered-token match - every token of the shorter name appears
 *      in the longer, so "smith, john" matches "john smith". Requires
 *      at least two tokens so a single shared common word (e.g. "inc")
 *      doesn't trip a match on its own.
 * Deliberately not phonetic / edit-distance, so typos and nicknames
 * still fall to human review.
 */
function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(' ').filter(Boolean);
  const tb = nb.split(' ').filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return false;
  const longSet = new Set(long);
  return short.every((t) => longSet.has(t));
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
  try {
    const { partnerTicketEvent } = await import('./partner-notify');
    await partnerTicketEvent(intakeId, 'ticket.status_changed');
  } catch {
    /* best-effort */
  }
  revalidatePath(`/counsel/intake/${intakeId}`);
  return { ok: true };
}
