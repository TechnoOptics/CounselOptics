'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerFirmRole, FIRM_POSTING_ROLES } from './firm-authz';
import { hydratePeople } from './intake-notify';
import { createNotification } from './notifications';
import { checkRateLimit } from './rate-limit';

/**
 * Asking a named colleague to fill in a particular firm form.
 *
 * WHY THIS EXISTS AND WHY IT IS SHAPED THIS WAY. The reference product's
 * approvals screen carries a request form in the middle: an employee asks for
 * hardware, and approving it creates the fulfilment ticket. Advottic's queue is
 * filled from the other direction. Every row in it is a colleague filling in a
 * firm template addressed to an outside party, and a reviewer takes no action
 * that starts one. So the honest counsel-side equivalent is not "request a
 * document" but "ask a named colleague to complete a specific form", which is
 * the one thing a lawyer looking at this queue actually wants and cannot do.
 *
 * createIntakeUploadRequestAction in lib/intake-conversation.ts was the nearest
 * existing thing and does not fit. It hangs off a firm_matter_intakes row,
 * which this surface has none of, and it asks for a FILE through a tokenized
 * public page rather than for a firm template filled in under the firm's own
 * merge and signature flow. Reusing it would have produced a link that lands
 * somewhere unrelated to this queue.
 *
 * WHAT THIS IS, STATED PLAINLY, BECAUSE THE UI SAYS THE SAME THING. It is a
 * message, not a tracked obligation. There is no table in this product that can
 * hold "the firm asked employee Y to complete template Z by date D": the only
 * assignment table, firm_training_assignments, has no SQL checked in and
 * nothing that creates a row in it. Building a tracked request would need a new
 * table and therefore a migration, and a migration the owner has not applied is
 * a form that posts nowhere. So this writes the one record that already exists
 * and already works on this exact flow, a notification, and the colleague's
 * bell carries a link straight to the fill page for that template. Nothing on
 * the page claims a due date, a status, or a reminder, because none of those
 * are behind it.
 *
 * Every export here is a public HTTP endpoint and every read below uses the
 * service-role client, which bypasses RLS, so the checks in this function are
 * the whole of the authorization. Three separate things are verified against
 * the CALLER's session rather than trusted from the arguments: that the caller
 * holds a role in this firm that may post firm work, that the template is this
 * firm's and is published, and that the colleague is an active member of this
 * firm's workspace. A caller who guesses a template id or a user id from
 * another firm gets the same refusal as one who guesses nothing.
 */

/** Roles that may ask a colleague for a form: owner, admin, attorney, paralegal. */
export async function canRequestTemplates(firmId: string): Promise<boolean> {
  const role = await callerFirmRole(firmId);
  return role != null && FIRM_POSTING_ROLES.includes(role);
}

/** One person this firm can ask for a form. */
export type RequestableColleague = { userId: string; label: string };

/**
 * The colleagues a request can actually reach.
 *
 * A separate read rather than listFirmEmployeeDirectory, which is the obvious
 * candidate and cannot do this job: FirmEmployeeListItem deliberately exposes
 * only `linked: boolean` and not the user id, and a notification is keyed on a
 * user id. Rather than widening that shape for every caller of it, this reads
 * the two columns it needs behind its own gate.
 *
 * Only active rows that carry a user id are returned, which is the same pair of
 * conditions the action re-checks before it writes. A person invited by email
 * who has never signed in has no auth user, so a notification cannot reach them
 * and they are not offered.
 */
export async function listRequestableColleagues(
  firmId: string,
): Promise<RequestableColleague[]> {
  if (!(await canRequestTemplates(firmId))) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data } = await admin
    .from('firm_employees')
    .select('user_id, display_name, email')
    .eq('firm_id', firmId)
    .is('deactivated_at', null)
    .order('display_name', { ascending: true, nullsFirst: false })
    .limit(1000);
  return ((data ?? []) as Array<{
    user_id: string | null;
    display_name: string | null;
    email: string;
  }>)
    .filter((r) => Boolean(r.user_id))
    .map((r) => ({ userId: r.user_id as string, label: r.display_name || r.email }));
}

export async function askColleagueForTemplateAction(
  firmId: string,
  templateId: string,
  employeeUserId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const role = await callerFirmRole(firmId);
  if (role == null || !FIRM_POSTING_ROLES.includes(role)) {
    return { ok: false, error: 'Your role cannot ask a colleague for a form.' };
  }

  // A message to a named colleague is a thing that can be used to pester one,
  // so it is metered like every other outbound in this flow.
  const allowed = await checkRateLimit(`template-request:${user.id}`, {
    limit: 60,
    windowSeconds: 3600,
  });
  if (!allowed) {
    return { ok: false, error: 'You have sent a lot of these. Try again later.' };
  }

  // The template must be THIS firm's and must be published: an employee cannot
  // fill in a draft or an archived one, so asking them to would send them to a
  // page that refuses them.
  const { data: templateRow } = await admin
    .from('firm_templates')
    .select('id, name')
    .eq('id', templateId)
    .eq('firm_id', firmId)
    .eq('status', 'published')
    .maybeSingle();
  const template = (templateRow as { id: string; name: string } | null) ?? null;
  if (!template) return { ok: false, error: 'That form is not available to ask for.' };

  // The colleague must be an ACTIVE member of this firm's workspace and must
  // have signed in at least once: firm_employees.user_id is nullable, and a
  // notification is keyed on a user id, so a row without one cannot be reached
  // this way and must not be offered as though it could.
  const { data: employeeRow } = await admin
    .from('firm_employees')
    .select('user_id')
    .eq('firm_id', firmId)
    .eq('user_id', employeeUserId)
    .is('deactivated_at', null)
    .maybeSingle();
  if (!((employeeRow as { user_id: string | null } | null)?.user_id)) {
    return { ok: false, error: 'That colleague is not on this workspace.' };
  }

  const people = await hydratePeople(admin, [user.id]);
  const actorName = people.get(user.id)?.name ?? 'The legal team';
  const trimmedNote = String(note ?? '').trim().slice(0, 500);

  // createNotification returns the row it inserted, or null when the insert
  // failed. A PostgREST write reports a miss as success with no row, so the
  // absence of a row is the failure signal and it is reported to the caller
  // rather than swallowed into a cheerful "sent".
  const sent = await createNotification({
    userId: employeeUserId,
    type: 'system',
    title: `${actorName} asked you to fill in ${template.name}`,
    body: trimmedNote || 'Open it to fill it in and send it for review.',
    link: `/portal/forms/${template.id}`,
    actorUserId: user.id,
  });
  if (!sent) return { ok: false, error: 'Could not send that just now. Try again shortly.' };

  revalidatePath('/counsel/forms/approvals');
  return { ok: true };
}
