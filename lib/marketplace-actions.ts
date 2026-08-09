'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerIsFirmMember } from './firm-authz';
import { routedLeadForFirm } from './marketplace-storage';

/**
 * Marketplace lead submission. The consumer (signed in or not)
 * fills out the /find-counsel form, this action creates the
 * firm_leads row and notifies firms whose jurisdictions +
 * practice areas match.
 *
 * Anonymous leads are allowed - the user might not have an
 * account yet. They get a copy of their lead via email and can
 * claim it later when they sign up.
 */
export async function submitFirmLeadAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; leadId?: string; matchedFirms?: number }> {
  const contactEmail = String(formData.get('contactEmail') ?? '').trim().toLowerCase();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const contactPhone = String(formData.get('contactPhone') ?? '').trim() || null;
  const state = String(formData.get('state') ?? '').trim().toUpperCase();
  const summary = String(formData.get('summary') ?? '').trim();
  const budget = String(formData.get('budget') ?? '').trim() || null;
  const urgencyRaw = String(formData.get('urgency') ?? 'normal').trim();
  const urgency = ['low', 'normal', 'high', 'emergency'].includes(urgencyRaw)
    ? urgencyRaw
    : 'normal';
  let practiceAreas: string[] = [];
  try {
    const raw = String(formData.get('practiceAreas') ?? '[]');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) practiceAreas = parsed.map(String);
  } catch {
    /* fall through */
  }

  if (!contactEmail || !/.+@.+\..+/.test(contactEmail)) {
    return { ok: false, error: 'A valid email is required.' };
  }
  if (!contactName) return { ok: false, error: 'Please tell us your name.' };
  if (!state) return { ok: false, error: 'Please pick your state.' };
  if (!summary || summary.length < 20) {
    return {
      ok: false,
      error: 'Please add a brief summary (at least 20 characters).',
    };
  }
  if (practiceAreas.length === 0) {
    return { ok: false, error: 'Pick at least one matter area.' };
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, error: 'Server is not fully configured.' };
  }

  const user = await getCurrentUser().catch(() => null);

  const { data: leadRow, error: leadErr } = await admin
    .from('firm_leads')
    .insert({
      user_id: user?.id ?? null,
      contact_email: contactEmail,
      contact_name: contactName,
      contact_phone: contactPhone,
      jurisdiction_country: 'US',
      jurisdiction_state: state,
      practice_areas: practiceAreas,
      summary,
      budget,
      urgency,
      status: 'open',
    })
    .select('id')
    .single();
  if (leadErr || !leadRow) {
    return { ok: false, error: leadErr?.message ?? 'Insert failed.' };
  }
  const leadId = (leadRow as { id: string }).id;

  // Find matching firms: those whose jurisdictions array contains the
  // state AND whose practice_areas overlap with the requested areas.
  // Firms can also opt-in to be a "general" match by listing
  // practice_areas containing the literal string 'all'.
  const { data: firmsRaw } = await admin
    .from('firms')
    .select('id, name, jurisdictions, practice_areas')
    .or(
      `jurisdictions.cs.{${state}},jurisdictions.cs.{US-${state}}`,
    );
  const firms = ((firmsRaw ?? []) as Array<{
    id: string;
    name: string;
    jurisdictions: string[] | null;
    practice_areas: string[] | null;
  }>).filter((f) => {
    const fa = (f.practice_areas ?? []).map((s) => s.toLowerCase());
    if (fa.includes('all')) return true;
    return practiceAreas.some((p) =>
      fa.includes(p.toLowerCase()),
    );
  });

  // For each matched firm, notify its owner + admins.
  if (firms.length > 0) {
    const { createNotification } = await import('./notifications');
    for (const f of firms) {
      const { data: members } = await admin
        .from('firm_members')
        .select('user_id, role')
        .eq('firm_id', f.id)
        .in('role', ['owner', 'admin', 'attorney']);
      const memberIds = ((members ?? []) as Array<{
        user_id: string;
        role: string;
      }>).map((m) => m.user_id);
      for (const uid of memberIds) {
        await createNotification({
          userId: uid,
          type: 'system',
          title: `New lead in ${state}: ${practiceAreas.slice(0, 2).join(', ')}`,
          body: summary.slice(0, 200) + (summary.length > 200 ? '...' : ''),
          link: `/counsel/leads/${leadId}`,
        });
      }
    }
    await admin
      .from('firm_leads')
      .update({ status: 'matched' })
      .eq('id', leadId);
  }

  revalidatePath('/find-counsel');
  return { ok: true, leadId, matchedFirms: firms.length };
}

/**
 * Firm responds to a lead with "interested" + an optional proposed
 * fee, or "pass". The consumer sees the response in their inbox.
 *
 * Two gates, and both are load-bearing, because this is a `'use server'`
 * export and therefore a public HTTP endpoint that anyone signed in can call
 * with a firmId and a leadId of their own choosing.
 *
 *   1. The caller must be a member of the firm they are answering as.
 *      Routed through lib/firm-authz.ts, which reads firm_members with the
 *      USER-scoped client, so a caller can only ever confirm their own
 *      membership row. The service-role client below bypasses RLS entirely
 *      and cannot be the thing that decides this.
 *
 *   2. The lead must be one of the leads routed to that firm. This one was
 *      missing, and its absence meant any firm could answer any lead by id,
 *      including one that was never offered to it: the consumer then got a
 *      notification saying a firm they had never been shown was interested in
 *      their matter, with no way to tell it apart from a real match. The
 *      answerable set is the visible set, so the gate is the same predicate
 *      the firm-side inbox filters on (lib/marketplace-storage.ts), not a
 *      second rule that could drift away from it.
 *
 * The refusal for gate 2 is identical whether the lead does not exist, was
 * never routed here, or has since closed, so it cannot be used to probe for
 * lead ids.
 */
export async function respondToLeadAction(
  firmId: string,
  leadId: string,
  responseType: 'interested' | 'pass',
  message: string | null,
  proposedFee: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is not fully configured.' };

  if (!(await callerIsFirmMember(firmId))) {
    return { ok: false, error: 'You are not a member of that firm.' };
  }

  const lead = await routedLeadForFirm(firmId, leadId);
  if (!lead) {
    return { ok: false, error: 'That lead is not open to your firm.' };
  }

  const { data: saved, error: upsertErr } = await admin
    .from('firm_lead_responses')
    .upsert(
      {
        lead_id: leadId,
        firm_id: firmId,
        responding_user_id: user.id,
        response_type: responseType,
        message,
        proposed_fee: proposedFee,
      },
      { onConflict: 'lead_id,firm_id' },
    )
    .select('id');
  if (upsertErr) return { ok: false, error: upsertErr.message };
  // PostgREST reports a write that matched nothing as a success with a null
  // error, so the row count is the only evidence the response was stored. Say
  // so rather than notifying the consumer about a response that is not there.
  if (!saved || (saved as unknown[]).length === 0) {
    return { ok: false, error: 'Your response could not be saved. Please try again.' };
  }

  // Notify the consumer (when we know who they are).
  const consumerUserId = lead.user_id;
  if (consumerUserId && responseType === 'interested') {
    const { createNotification } = await import('./notifications');
    const { data: firmRow } = await admin
      .from('firms')
      .select('name')
      .eq('id', firmId)
      .maybeSingle();
    const firmName =
      (firmRow as { name?: string } | null)?.name ?? 'A firm';
    await createNotification({
      userId: consumerUserId,
      type: 'system',
      title: `${firmName} is interested in your matter`,
      body:
        message ??
        `${firmName} reviewed your brief and wants to take it on. Open the lead to see their proposal and decide whether to accept.`,
      link: `/inbox/leads/${leadId}`,
    });
  }

  revalidatePath('/counsel/leads');
  revalidatePath(`/counsel/leads/${leadId}`);
  return { ok: true };
}

/**
 * Consumer accepts a specific firm's "interested" response. The
 * firm gets contact details revealed; other firms get a polite
 * "the consumer chose another firm" notification.
 */
export async function acceptFirmAction(
  leadId: string,
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is not fully configured.' };

  const { data: lead } = await admin
    .from('firm_leads')
    .select('id, user_id')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: 'Lead not found.' };
  if ((lead as { user_id?: string | null }).user_id !== user.id) {
    return { ok: false, error: 'You can only accept on your own leads.' };
  }

  // Mark accepted on the chosen firm; mark declined on the others.
  await admin
    .from('firm_lead_responses')
    .update({ response_type: 'accepted' })
    .eq('lead_id', leadId)
    .eq('firm_id', firmId);

  await admin
    .from('firm_lead_responses')
    .update({ response_type: 'declined_by_user' })
    .eq('lead_id', leadId)
    .neq('firm_id', firmId)
    .eq('response_type', 'interested');

  await admin
    .from('firm_leads')
    .update({ status: 'closed' })
    .eq('id', leadId);

  // Notify firm members of acceptance + contact details.
  const { createNotification } = await import('./notifications');
  const { data: members } = await admin
    .from('firm_members')
    .select('user_id, role')
    .eq('firm_id', firmId)
    .in('role', ['owner', 'admin', 'attorney']);
  for (const m of (members ?? []) as Array<{ user_id: string }>) {
    await createNotification({
      userId: m.user_id,
      type: 'system',
      title: 'Lead accepted you',
      body: 'Open the lead to see contact details and follow up.',
      link: `/counsel/leads/${leadId}`,
    });
  }

  revalidatePath('/counsel/leads');
  revalidatePath(`/inbox/leads/${leadId}`);
  return { ok: true };
}
