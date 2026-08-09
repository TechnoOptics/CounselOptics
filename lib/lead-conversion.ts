'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import {
  FIRM_POSTING_ROLES,
  callerHasFirmRole,
  requireActiveFirm,
} from './firm-authz';
import { readLeadCaseLink } from './marketplace-storage';

/**
 * Open a matter from a marketplace lead the consumer accepted this firm on.
 *
 * THE SAME MECHANISM AS INTAKE, not a second one. convertIntakeToCaseAction
 * writes a firm-scoped `cases` row from the request's fields, links it back on
 * the source record and is idempotent through that link. This does the same
 * three things over firm_leads, because the two record shapes carry the same
 * facts under different names: client name, matter type (practice areas),
 * summary and state. It is a separate file only because lib/marketplace-*.ts
 * is being edited elsewhere; the shape is deliberately copied, not invented.
 *
 * The one thing leads have that intake does not is a second party. A lead is
 * broadcast to every firm that matches it, so membership alone is not enough:
 * the check below is that THIS firm holds the `accepted` response, which is
 * the same fact that unmasks the contact details. Without it any posting-role
 * member of any firm could open a matter carrying another consumer's name.
 */
export async function convertLeadToCaseAction(
  firmId: string,
  leadId: string,
): Promise<{ ok: boolean; error?: string; caseId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!firmId || !leadId) return { ok: false, error: 'Lead not found.' };

  // AuthZ through lib/firm-authz.ts, the one firm axis. Posting roles, the
  // same set convertIntakeToCaseAction allows, because this creates a matter.
  if (!(await callerHasFirmRole(firmId, FIRM_POSTING_ROLES))) {
    return { ok: false, error: 'You do not have permission to open a matter.' };
  }
  // Opening a matter is the organization working. Every other create path is
  // gated this way, and gating one of a set while its twin stays open enforces
  // nothing.
  await requireActiveFirm(firmId);

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  // Did this consumer choose this firm? Read straight from the response row
  // rather than from anything the caller passed in.
  const { data: respRow } = await admin
    .from('firm_lead_responses')
    .select('response_type')
    .eq('lead_id', leadId)
    .eq('firm_id', firmId)
    .maybeSingle();
  const responseType = (respRow as { response_type?: string } | null)
    ?.response_type;
  if (responseType !== 'accepted') {
    return {
      ok: false,
      error: 'You can open a matter once this person has chosen your firm.',
    };
  }

  // Idempotency depends on the link column. If it cannot be read, refuse:
  // opening a matter that cannot be linked would open another one on the next
  // press, and a duplicate matter carrying a client's name is worse than a
  // refusal that says what is missing.
  const link = await readLeadCaseLink(admin, leadId);
  if (!link.supported) {
    return {
      ok: false,
      error:
        'Opening a matter from a lead is not available on this deployment yet. An administrator needs to apply the pending database update.',
    };
  }
  if (link.caseId) return { ok: true, caseId: link.caseId };

  const { data: leadRow } = await admin
    .from('firm_leads')
    .select(
      'id, contact_name, jurisdiction_state, practice_areas, summary, budget',
    )
    .eq('id', leadId)
    .maybeSingle();
  const lead = leadRow as {
    id: string;
    contact_name: string | null;
    jurisdiction_state: string | null;
    practice_areas: string[] | null;
    summary: string | null;
    budget: string | null;
  } | null;
  if (!lead) return { ok: false, error: 'Lead not found.' };

  const areas = (lead.practice_areas ?? []).filter(Boolean);
  const clientName = (lead.contact_name ?? '').trim();
  const title =
    areas.slice(0, 2).join(', ').trim() ||
    (clientName ? `${clientName} matter` : '') ||
    'New matter';

  const { data: created, error: caseErr } = await admin
    .from('cases')
    .insert({
      firm_id: firmId,
      user_id: user.id,
      title,
      subject_name: clientName || title,
      subject_type: 'person',
      case_type: areas[0] ?? 'other',
      status: 'open',
      posture: 'claimant',
      description: lead.summary ?? '',
      jurisdiction_country: 'US',
      jurisdiction_state: lead.jurisdiction_state ?? '',
      jurisdiction_city: '',
      sandbox: false,
    })
    .select('id')
    .single();
  if (caseErr || !created) {
    return { ok: false, error: caseErr?.message ?? 'Could not open the matter.' };
  }
  const caseId = (created as { id: string }).id;

  // The link is what makes this idempotent, so a write that touched no row is
  // a failure the firm has to see. PostgREST reports no error when an UPDATE
  // matches nothing, so the row count is the only evidence.
  const { data: linked, error: linkErr } = await admin
    .from('firm_leads')
    .update({ case_id: caseId, updated_at: new Date().toISOString() })
    .eq('id', leadId)
    .select('id');
  if (linkErr || ((linked ?? []) as unknown[]).length === 0) {
    return {
      ok: false,
      error: `The matter was opened, but the lead could not be linked to it. Open it from Matters and do not press this again: ${
        linkErr?.message ?? 'no lead row was updated'
      }`,
      caseId,
    };
  }

  revalidatePath('/counsel/leads');
  revalidatePath(`/counsel/leads/${leadId}`);
  revalidatePath('/counsel/cases');
  return { ok: true, caseId };
}
