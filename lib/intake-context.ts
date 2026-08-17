import 'server-only';

import type { createServerSupabase } from './supabase/server';

/**
 * The context a lawyer wants on opening a ticket: what has been signed on
 * it, and what else this person has asked the legal team for.
 *
 * EVERY FUNCTION HERE TAKES THE RLS-ENFORCED USER CLIENT, NEVER THE ADMIN
 * ONE. That is the whole access-control design and it is not an accident of
 * the call sites. The live policies already encode who may read what:
 *
 *   firm_documents_member_select   owner, admin, attorney, paralegal
 *   firm_signing_requests_member_select   ANY firm member, no role filter
 *   firm_matter_intakes_member     ANY firm member, no role filter
 *
 * Passing the service-role client to any of these would silently discard
 * all three. Do not add an admin-client overload.
 */

/**
 * The RLS-enforced request-scoped client.
 *
 * Typed from createServerSupabase rather than as a bare SupabaseClient so
 * the intent is legible. It does NOT make passing the service-role client a
 * compile error: an earlier version of this comment claimed it did, and
 * compiling a file that hands createAdminSupabase() to these functions
 * proved otherwise, because both clients are structurally the same type.
 * The rule is enforced by tests/intake-context-scoping.test.ts, which reads
 * this file and the call site, not by the type system.
 */
type Db = ReturnType<typeof createServerSupabase>;

export type TicketSigningEntry = {
  documentId: string;
  name: string;
  status: string;
  sentAt: string | null;
  completedAt: string | null;
};

export type RequesterIntake = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
};

/** How many of the requester's other tickets the rail lists. */
export const REQUESTER_HISTORY_LIMIT = 5;

/**
 * The signing activity on a ticket's own documents.
 *
 * THE ORDER OF THESE TWO QUERIES IS THE ACCESS CONTROL, which is why it is
 * written down here and pinned by a test rather than left to read as an
 * implementation detail.
 *
 * `firm_documents_member_select` admits owner, admin, attorney and
 * paralegal, deliberately excluding `staff`: supabase/migrations/
 * 20260731_staff_role_read_scope.sql screened receptionists and billing
 * staff out of firm documents, because the product promises them
 * "read-only access to non-privileged surfaces" in writing at the moment
 * they are invited.
 *
 * `firm_signing_requests_member_select` carries NO role filter at all. Any
 * firm member reads every signing request in their firm.
 *
 * So a panel built by asking firm_signing_requests for this firm's rows
 * and joining outward to names would hand a `staff` member the fact that a
 * document exists, what it is called and whether it has been signed: the
 * exact disclosure that migration was written to prevent. Reading
 * firm_documents FIRST and looking up signing requests only for the ids it
 * returned makes the documents policy the gate, and a `staff` member gets
 * an empty list at the first step and never reaches the second.
 *
 * Returns one row per DOCUMENT that has signing activity, newest first.
 */
export async function loadTicketSigningActivity(
  supabase: Db,
  intakeId: string,
): Promise<TicketSigningEntry[]> {
  // Step one, and the gate. Never reorder these.
  const { data: docRows } = await supabase
    .from('firm_documents')
    .select('id, name')
    .eq('intake_id', intakeId)
    .is('archived_at', null)
    .limit(200);
  const docs = (docRows ?? []) as Array<{ id: string; name: string }>;
  if (docs.length === 0) return [];

  const byId = new Map(docs.map((d) => [d.id, d.name]));
  // Step two, scoped to the ids step one was allowed to return.
  const { data: reqRows } = await supabase
    .from('firm_signing_requests')
    .select('id, document_id, status, sent_at, completed_at')
    .in('document_id', [...byId.keys()])
    .limit(200);

  const rows = (reqRows ?? []) as Array<{
    document_id: string;
    status: string;
    sent_at: string | null;
    completed_at: string | null;
  }>;

  // One entry per document. A document sent for signature more than once
  // shows its most advanced request rather than one line per attempt,
  // because the question this panel answers is "is this signed yet".
  const best = new Map<string, TicketSigningEntry>();
  for (const r of rows) {
    const name = byId.get(r.document_id);
    if (!name) continue;
    const entry: TicketSigningEntry = {
      documentId: r.document_id,
      name,
      status: r.status,
      sentAt: r.sent_at,
      completedAt: r.completed_at,
    };
    const prev = best.get(r.document_id);
    if (!prev || (entry.completedAt && !prev.completedAt)) {
      best.set(r.document_id, entry);
    }
  }
  return [...best.values()].sort((a, b) =>
    String(b.completedAt ?? b.sentAt ?? '').localeCompare(
      String(a.completedAt ?? a.sentAt ?? ''),
    ),
  );
}

/**
 * The other tickets this person has filed with this firm.
 *
 * Scoped by firm AND by the requester, and read through the user client so
 * `firm_matter_intakes_member` decides whether the caller may see the
 * firm's intakes at all. This discloses nothing a firm member cannot
 * already list at /counsel/intake; it saves them the search.
 *
 * Returns nothing when the ticket has no `created_by`, which is the case
 * for matters opened by the firm itself rather than filed by a person.
 */
export async function loadRequesterOtherIntakes(
  supabase: Db,
  intake: { id: string; firm_id: string; created_by: string | null },
): Promise<RequesterIntake[]> {
  if (!intake.created_by) return [];
  const { data } = await supabase
    .from('firm_matter_intakes')
    .select('id, matter_type, status, created_at, intake_answers')
    .eq('firm_id', intake.firm_id)
    .eq('created_by', intake.created_by)
    .neq('id', intake.id)
    .order('created_at', { ascending: false })
    .limit(REQUESTER_HISTORY_LIMIT);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const a = (r.intake_answers ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      title:
        String(a.subject ?? '').trim() ||
        String(r.matter_type ?? '').trim() ||
        'Untitled request',
      status: String(r.status ?? ''),
      createdAt: String(r.created_at ?? ''),
    };
  });
}
