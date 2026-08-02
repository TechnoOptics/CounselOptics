import 'server-only';
import crypto from 'crypto';
import { createAdminSupabase } from './supabase/admin';
import { verifyApiToken, tokenHasScope, type VerifiedToken } from './api-tokens';
import { classifyEmail } from './access-requests';
import { checkRateLimit } from './rate-limit';
import type { ThreadMessage } from './intake-thread';
import { readPartnerConfig, type PartnerQuestion } from './partner-config-core';
import { partnerTicketEvent } from './partner-notify';
import { getPublishedPayload } from './form-queries';
import { bindPartnerFormAnswers, partnerFormBinding } from './form-to-partner';
import type { QuestionAnswer } from './intake-form-fallback';
import {
  INTAKE_COLS as CONV_INTAKE_COLS,
  insertIntakeMessage,
  notifyIntakeActivity,
  refFor,
  revalidateIntake,
  type IntakeRow as ConversationIntakeRow,
} from './intake-notify';

/**
 * Partner ticketing bridge: the server core behind /api/partner/v1/*.
 *
 * Purpose: a corporate companion app (first partner: the Zinpro employee app)
 * files legal requests on behalf of a company's employees. The company holds a
 * firm/enterprise Advottic license; the partner app authenticates with a
 * firm-scoped API token (`api_tokens`, `adv_...`, scope `write`). Each ticket:
 *
 *   1. JIT-provisions the employee in `firm_employees` (keyed by email; the
 *      email domain must be one of the firm's registered `emailDomains`).
 *      `user_id` stays null until the employee first signs in via SSO;
 *      lib/persona.ts links the row and `claimPartnerTickets` re-attributes
 *      their tickets, so the portal shows everything they filed from the
 *      partner app.
 *   2. Creates a `firm_matter_intakes` row, the SAME intake object the legal
 *      team already works in the counsel Intake inbox (kanban, conflict check,
 *      convert-to-case, uploads, thread). No parallel pipeline.
 *   3. Conversation flows through the intake thread (`intake_answers.thread`),
 *      readable/writable from both the portal and the partner API.
 *
 * Every ticket carries `intake_answers.partner = { source, externalId,
 * employeeEmail }` so the partner app can correlate by its own ticket id and
 * the portal can claim rows on first sign-in.
 */

export type PartnerAuth = {
  token: VerifiedToken;
  firmId: string;
};

export type PartnerTicket = {
  id: string;
  status: string;
  subject: string | null;
  summary: string | null;
  category: string | null;
  priority: string | null;
  createdAt: string;
  updatedAt: string | null;
  externalId: string | null;
  employeeEmail: string | null;
  caseId: string | null;
  messages: { id: string; author: string; role: 'employee' | 'legal'; at: string; text: string }[];
};

const TICKETS_PER_WINDOW = 60; // per firm per 5 min: generous for a workforce, blunt for a loop
const MESSAGES_PER_WINDOW = 240;

/** Authenticate a partner request: valid token + firm scope + write scope. */
export async function authenticatePartner(
  authorizationHeader: string | null,
): Promise<{ ok: true; auth: PartnerAuth } | { ok: false; status: number; error: string }> {
  const verified = await verifyApiToken(authorizationHeader);
  if (!verified) return { ok: false, status: 401, error: 'Invalid or revoked API token.' };
  if (!verified.firmId) {
    return { ok: false, status: 403, error: 'This token is not firm-scoped. Mint a firm token for the integration.' };
  }
  if (!tokenHasScope(verified, 'write')) {
    return { ok: false, status: 403, error: 'This token lacks the write scope.' };
  }
  return { ok: true, auth: { token: verified, firmId: verified.firmId } };
}

/** Per-firm rate limits so a partner-side loop can never flood the inbox. */
export async function partnerRateLimit(
  firmId: string,
  kind: 'ticket' | 'message',
): Promise<boolean> {
  return checkRateLimit(`partner:${kind}:${firmId}`, {
    limit: kind === 'ticket' ? TICKETS_PER_WINDOW : MESSAGES_PER_WINDOW,
    windowSeconds: 300,
  });
}

/**
 * JIT employee provisioning. The email's domain must belong to the firm
 * (firms.metadata.emailDomains via classifyEmail), so a partner token can never
 * introduce accounts outside the company's own domain. Returns the
 * firm_employees row id (existing or newly created).
 */
export async function ensureEmployee(
  firmId: string,
  employee: { email: string; name?: string | null; department?: string | null },
): Promise<{ ok: true; employeeId: string; userId: string | null } | { ok: false; status: number; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, status: 500, error: 'Server not configured.' };
  const email = employee.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, status: 400, error: 'employee.email is not a valid email address.' };
  }

  const { data: firm } = await admin.from('firms').select('id, metadata').eq('id', firmId).maybeSingle();
  if (!firm) return { ok: false, status: 404, error: 'Firm not found.' };
  const cls = classifyEmail((firm as { metadata: Record<string, unknown> | null }).metadata, email);
  if (cls !== 'internal') {
    return {
      ok: false,
      status: 403,
      error: `The domain of ${email} is not registered as an internal domain for this firm. Add it under Counsel → Settings → Access.`,
    };
  }

  const { data: existing } = await admin
    .from('firm_employees')
    .select('id, user_id, deactivated_at')
    .eq('firm_id', firmId)
    .eq('email', email)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; user_id: string | null; deactivated_at: string | null };
    if (row.deactivated_at) {
      return { ok: false, status: 403, error: 'This employee account is deactivated.' };
    }
    return { ok: true, employeeId: row.id, userId: row.user_id };
  }

  const { data: created, error } = await admin
    .from('firm_employees')
    .insert({
      firm_id: firmId,
      email,
      display_name: employee.name?.trim() || email.split('@')[0],
      department: employee.department?.trim() || null,
      role_key: 'employee',
      source: 'partner',
      user_id: null,
    })
    .select('id')
    .single();
  if (error || !created) {
    return { ok: false, status: 500, error: error?.message ?? 'Could not provision the employee.' };
  }
  return { ok: true, employeeId: (created as { id: string }).id, userId: null };
}

type IntakeRow = {
  id: string;
  status: string;
  matter_type: string | null;
  matter_summary: string | null;
  client_name: string | null;
  client_email: string | null;
  case_id: string | null;
  created_at: string;
  updated_at: string | null;
  intake_answers: Record<string, unknown> | null;
};

/**
 * Messages now live in firm_intake_messages. The partner API only ever sees
 * `shared` rows, so the legal team's internal notes can never leak to the
 * company app. That separation is enforced here and in RLS, not in the UI.
 */
async function loadSharedMessages(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  intakeId: string,
): Promise<PartnerTicket['messages']> {
  const { data } = await admin
    .from('firm_intake_messages')
    .select('id, author_name, author_role, created_at, body, kind')
    .eq('intake_id', intakeId)
    .eq('visibility', 'shared')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(500);
  return ((data ?? []) as Record<string, unknown>[])
    .filter((m) => m.kind !== 'event')
    .map((m) => ({
      id: String(m.id),
      author: String(m.author_name ?? 'Someone'),
      role: (m.author_role === 'legal' ? 'legal' : 'employee') as 'legal' | 'employee',
      at: String(m.created_at),
      text: String(m.body ?? ''),
    }));
}

function toTicket(row: IntakeRow, messages: PartnerTicket['messages'] = []): PartnerTicket {
  const a = row.intake_answers ?? {};
  const partner = (a.partner ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    status: row.status,
    subject: (a.subject as string) ?? row.matter_type,
    summary: row.matter_summary,
    category: row.matter_type,
    priority: (a.priority as string) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    externalId: (partner.externalId as string) ?? null,
    employeeEmail: (partner.employeeEmail as string) ?? row.client_email,
    caseId: row.case_id,
    messages,
  };
}

const INTAKE_COLS =
  'id, status, matter_type, matter_summary, client_name, client_email, case_id, created_at, updated_at, intake_answers';

/** Create a ticket (idempotent per (firm, externalId) when externalId given). */
export async function createPartnerTicket(
  auth: PartnerAuth,
  input: {
    employee: { email: string; name?: string | null; department?: string | null };
    subject: string;
    description: string;
    category?: string | null;
    priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
    externalId?: string | null;
    /** Answers to the firm-configured intake questions, keyed by question id
     *  (fetch the questions from GET /api/partner/v1/config). */
    answers?: Record<string, string> | null;
    /** The `formVersionId` GET /api/partner/v1/config returned alongside the
     *  questions these answers were collected on, echoed back. Optional, and
     *  treated as untrusted: it is only ever compared against the version this
     *  firm has published for this request type, never looked up. */
    formVersionId?: string | null;
  },
): Promise<
  | { ok: true; ticket: PartnerTicket; created: boolean; acknowledgment: string }
  | { ok: false; status: number; error: string }
> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, status: 500, error: 'Server not configured.' };
  const subject = (input.subject ?? '').trim().slice(0, 200);
  const description = (input.description ?? '').trim().slice(0, 20000);
  if (!subject || !description) {
    return { ok: false, status: 400, error: 'subject and description are required.' };
  }

  const emp = await ensureEmployee(auth.firmId, input.employee);
  if (!emp.ok) return emp;

  // Firm-configured intake questions + the acknowledgment popup message.
  const { data: firmRow } = await admin
    .from('firms')
    .select('name, metadata')
    .eq('id', auth.firmId)
    .maybeSingle();
  const firm = firmRow as { name: string; metadata: Record<string, unknown> | null } | null;
  const config = readPartnerConfig(firm?.metadata);

  const externalId = input.externalId?.trim() || null;
  if (externalId) {
    const { data: dupe } = await admin
      .from('firm_matter_intakes')
      .select(INTAKE_COLS)
      .eq('firm_id', auth.firmId)
      .contains('intake_answers', { partner: { externalId } })
      .maybeSingle();
    if (dupe) {
      return {
        ok: true,
        ticket: toTicket(dupe as IntakeRow, await loadSharedMessages(admin, (dupe as IntakeRow).id)),
        created: false,
        acknowledgment: config.ackMessage,
      };
    }
  }

  // Validate + label the question answers so the intake detail can render
  // them without re-reading the (possibly since-edited) question config.
  //
  // Which question set that is depends on whether the legal team has built a
  // form for this request type. `category` is the request type's `key`: a
  // partner ticket carries the partner's own slug in matter_type and that slug
  // IS the join (see supabase/migrations/20260801_intake_form_builder.sql).
  // It is matched verbatim, never by label, because a looser match would bind
  // a ticket to a form it was not filed against.
  const typeKey = input.category?.trim() ?? '';
  const binding = partnerFormBinding(
    typeKey ? await getPublishedPayload(admin, auth.firmId, typeKey) : null,
    input.formVersionId,
    input.answers,
  );

  let list: QuestionAnswer[] = [];
  if (binding?.governs) {
    const bound = bindPartnerFormAnswers(binding, input.answers);
    if (!bound.ok) return { ok: false, status: 400, error: bound.error };
    list = bound.list;
  } else {
    const legacy = resolveQuestionAnswers(config.questions, input.answers);
    if (!legacy.ok) return { ok: false, status: 400, error: legacy.error };
    list = legacy.list;
  }

  const email = input.employee.email.trim().toLowerCase();
  const name = input.employee.name?.trim() || email.split('@')[0];
  const row = {
    firm_id: auth.firmId,
    client_name: name,
    client_email: email,
    matter_type: input.category?.trim() || 'Legal request',
    matter_summary: description,
    opposing_parties: [],
    related_parties: [],
    intake_answers: {
      subject,
      priority: input.priority ?? 'normal',
      inhouse: true,
      ...(list.length > 0 ? { questionAnswers: list } : {}),
      partner: {
        source: 'zinpro',
        externalId,
        employeeEmail: email,
        tokenId: auth.token.id,
        // How the version binding below was arrived at. There is no column
        // for this and it is partner-path-only, so it rides in the same jsonb
        // the rest of the partner metadata already uses. 'echoed' means the
        // ticket named that exact version, so the answers were collected on
        // it and judged against it. 'inferred' means we bound it to whatever
        // was live on arrival; when the ticket showed no sign of having the
        // form, the answers were judged against the firm-wide partner
        // questions instead, and this field is where that shows.
        ...(binding ? { formVersionSource: binding.source } : {}),
      },
    },
    // Attributed to the linked auth user when the employee has signed in
    // before; otherwise to the token owner until claimPartnerTickets
    // re-attributes on the employee's first SSO sign-in.
    created_by: emp.userId ?? auth.token.userId,
    status: 'in_progress',
    // Named only when there is a binding to record, the same way the portal
    // submit path does it: an insert that never mentions the column cannot
    // fail anywhere the migration has not run.
    ...(binding ? { form_version_id: binding.versionId } : {}),
  };
  const { data: created, error } = await admin
    .from('firm_matter_intakes')
    .insert(row)
    .select(INTAKE_COLS)
    .single();
  if (error || !created) {
    return { ok: false, status: 500, error: error?.message ?? 'Could not create the ticket.' };
  }
  // Wake the legal team (bell + email) because an API-born ticket has no one
  // staring at a screen when it lands. Best-effort, never fails the create.
  await partnerTicketEvent((created as IntakeRow & { firm_id: string }).id, 'ticket.created', {
    firmName: firm?.name ?? null,
  });
  return {
    ok: true,
    ticket: toTicket(created as IntakeRow),
    created: true,
    acknowledgment: config.ackMessage,
  };
}

/** Match submitted answers to the configured questions; missing required
 *  answers reject the create so the legal team always gets what they asked
 *  for. Unknown ids are dropped (a stale partner-side form can't inject). */
function resolveQuestionAnswers(
  questions: PartnerQuestion[],
  answers: Record<string, string> | null | undefined,
):
  | { ok: true; list: Array<{ id: string; label: string; value: string }> }
  | { ok: false; error: string } {
  const given = answers ?? {};
  const list: Array<{ id: string; label: string; value: string }> = [];
  for (const q of questions) {
    const value = String(given[q.id] ?? '').trim().slice(0, 2000);
    if (!value) {
      if (q.required) {
        return { ok: false, error: `Missing required answer: "${q.label}" (question id ${q.id}).` };
      }
      continue;
    }
    if (q.type === 'select' && q.options && q.options.length > 0 && !q.options.includes(value)) {
      return {
        ok: false,
        error: `Answer for "${q.label}" must be one of: ${q.options.join(', ')}.`,
      };
    }
    list.push({ id: q.id, label: q.label, value });
  }
  return { ok: true, list };
}

/** List tickets, optionally for one employee, newest first. */
export async function listPartnerTickets(
  auth: PartnerAuth,
  filter: { employeeEmail?: string | null; limit?: number },
): Promise<{ ok: true; tickets: PartnerTicket[] } | { ok: false; status: number; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, status: 500, error: 'Server not configured.' };
  let q = admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('firm_id', auth.firmId)
    .not('intake_answers->partner', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  if (filter.employeeEmail) {
    q = q.eq('client_email', filter.employeeEmail.trim().toLowerCase());
  }
  const { data, error } = await q;
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, tickets: ((data ?? []) as IntakeRow[]).map((r) => toTicket(r as IntakeRow)) };
}

/** Fetch one ticket (must belong to the token's firm AND be partner-born). */
export async function getPartnerTicket(
  auth: PartnerAuth,
  ticketId: string,
): Promise<{ ok: true; ticket: PartnerTicket } | { ok: false; status: number; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, status: 500, error: 'Server not configured.' };
  const { data } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('firm_id', auth.firmId)
    .eq('id', ticketId)
    .maybeSingle();
  if (!data) return { ok: false, status: 404, error: 'Ticket not found.' };
  const t = toTicket(data as IntakeRow, await loadSharedMessages(admin, (data as IntakeRow).id));
  if (!t.employeeEmail || !(data as IntakeRow).intake_answers?.partner) {
    return { ok: false, status: 404, error: 'Ticket not found.' };
  }
  return { ok: true, ticket: t };
}

/** Append an employee message to the ticket thread (mirrors intake-thread). */
export async function postPartnerTicketMessage(
  auth: PartnerAuth,
  ticketId: string,
  input: { employeeEmail: string; text: string },
): Promise<{ ok: true; ticket: PartnerTicket } | { ok: false; status: number; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, status: 500, error: 'Server not configured.' };
  const text = (input.text ?? '').trim().slice(0, 8000);
  if (!text) return { ok: false, status: 400, error: 'text is required.' };

  const { data } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('firm_id', auth.firmId)
    .eq('id', ticketId)
    .maybeSingle();
  if (!data) return { ok: false, status: 404, error: 'Ticket not found.' };
  const row = data as IntakeRow;
  const answers = row.intake_answers ?? {};
  const partner = (answers.partner ?? {}) as Record<string, unknown>;
  const email = input.employeeEmail.trim().toLowerCase();
  if ((partner.employeeEmail as string)?.toLowerCase() !== email) {
    return { ok: false, status: 403, error: 'This ticket belongs to a different employee.' };
  }

  const { data: empRow } = await admin
    .from('firm_employees')
    .select('user_id, display_name')
    .eq('firm_id', auth.firmId)
    .eq('email', email)
    .maybeSingle();
  const emp = empRow as { user_id: string | null; display_name: string | null } | null;

  const authorName = emp?.display_name || email.split('@')[0];
  const authorUserId = emp?.user_id ?? null;

  // Messages live in firm_intake_messages now, so a reply filed from the
  // company app appears in the legal team's live conversation immediately.
  const { data: full } = await admin
    .from('firm_matter_intakes')
    .select(CONV_INTAKE_COLS)
    .eq('id', row.id)
    .maybeSingle();
  if (!full) return { ok: false, status: 404, error: 'Ticket not found.' };
  const intake = full as ConversationIntakeRow;

  const message = await insertIntakeMessage({
    admin,
    intake,
    authorUserId,
    authorName,
    authorRole: 'employee',
    visibility: 'shared',
    body: text,
  });
  if (!message) return { ok: false, status: 500, error: 'Could not post the message.' };

  // Branded, ticket-aware notification to the legal team; the webhook fan-out
  // stays with partnerTicketEvent so the partner app still gets its event.
  await notifyIntakeActivity({
    admin,
    intake,
    message,
    actor: { userId: authorUserId ?? 'partner', name: authorName, avatarUrl: null, side: 'employee' },
    eyebrow: 'New reply on a request',
    headline: () => `${authorName} replied on ${refFor(intake)}`,
  });
  await partnerTicketEvent(row.id, 'ticket.employee_replied', {
    webhookOnly: true,
    message: {
      id: message.id,
      byUserId: authorUserId ?? 'partner',
      name: authorName,
      role: 'employee',
      at: message.createdAt,
      text,
    },
  });
  revalidateIntake(row.id);

  const { data: refreshed } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('id', row.id)
    .maybeSingle();
  return {
    ok: true,
    ticket: toTicket((refreshed ?? row) as IntakeRow, await loadSharedMessages(admin, row.id)),
  };
}

/**
 * Called from lib/persona.ts the moment a firm employee's auth account is
 * linked (first SSO sign-in): every partner ticket filed for their email is
 * re-attributed to them, so the Hub portal lists their full history.
 */
export async function claimPartnerTickets(firmId: string, email: string, userId: string): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return;
  try {
    const { data } = await admin
      .from('firm_matter_intakes')
      .select('id, created_by')
      .eq('firm_id', firmId)
      .eq('client_email', email.trim().toLowerCase())
      .not('intake_answers->partner', 'is', null);
    const rows = (data ?? []) as { id: string; created_by: string | null }[];
    for (const r of rows) {
      if (r.created_by !== userId) {
        await admin.from('firm_matter_intakes').update({ created_by: userId }).eq('id', r.id);
      }
    }
  } catch {
    // Claiming is best-effort; the tickets stay reachable via the partner API.
  }
}
