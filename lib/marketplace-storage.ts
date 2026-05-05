import { createAdminSupabase } from './supabase/admin';

export type FirmLeadForFirm = {
  id: string;
  contactNameMasked: string;
  jurisdictionState: string | null;
  practiceAreas: string[];
  summary: string;
  budget: string | null;
  urgency: string | null;
  createdAt: string;
  /** Set when this firm has already responded to the lead. */
  firmResponse: {
    responseType: 'interested' | 'pass' | 'accepted' | 'declined_by_user';
    proposedFee: string | null;
    message: string | null;
    createdAt: string;
  } | null;
  /** True after the consumer accepts this firm; until then we hide
   *  the contact channels (email, phone, last name). */
  acceptedByConsumer: boolean;
  /** Only populated when acceptedByConsumer is true. */
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactName?: string | null;
};

/**
 * Lead readout for the firm-side inbox. Until the consumer accepts
 * the firm's "interested" response, the contact channels stay
 * masked - the firm sees enough to decide whether to take the
 * matter, no more.
 */
export async function listFirmLeadsForFirm(
  firmId: string,
): Promise<FirmLeadForFirm[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  // Pull every open or matched lead in this firm's jurisdictions +
  // areas. We re-filter client-side rather than baking another match
  // query because firm preferences may change after a lead lands.
  const { data: firmRow } = await admin
    .from('firms')
    .select('jurisdictions, practice_areas')
    .eq('id', firmId)
    .maybeSingle();
  const firm = firmRow as
    | { jurisdictions: string[] | null; practice_areas: string[] | null }
    | null;
  if (!firm) return [];
  const jurisdictions = (firm.jurisdictions ?? []).map((j) =>
    j.toUpperCase().replace(/^US-/, ''),
  );
  const firmAreas = (firm.practice_areas ?? []).map((p) => p.toLowerCase());

  // Leads in any of the firm's states.
  const { data: leadsRaw } = await admin
    .from('firm_leads')
    .select(
      'id, contact_name, contact_email, contact_phone, jurisdiction_state, practice_areas, summary, budget, urgency, status, created_at',
    )
    .in('status', ['open', 'matched'])
    .order('created_at', { ascending: false });
  const leads = ((leadsRaw ?? []) as Array<{
    id: string;
    contact_name: string;
    contact_email: string;
    contact_phone: string | null;
    jurisdiction_state: string | null;
    practice_areas: string[] | null;
    summary: string;
    budget: string | null;
    urgency: string | null;
    status: string;
    created_at: string;
  }>).filter((l) => {
    const matchesJur =
      !l.jurisdiction_state ||
      jurisdictions.length === 0 ||
      jurisdictions.includes(l.jurisdiction_state.toUpperCase());
    const matchesArea =
      firmAreas.includes('all') ||
      (l.practice_areas ?? []).some((p) =>
        firmAreas.includes(p.toLowerCase()),
      );
    return matchesJur && matchesArea;
  });

  if (leads.length === 0) return [];

  // Pull responses this firm has made.
  const { data: respRaw } = await admin
    .from('firm_lead_responses')
    .select('lead_id, response_type, proposed_fee, message, created_at')
    .eq('firm_id', firmId)
    .in(
      'lead_id',
      leads.map((l) => l.id),
    );
  const respMap = new Map<
    string,
    {
      response_type: 'interested' | 'pass' | 'accepted' | 'declined_by_user';
      proposed_fee: string | null;
      message: string | null;
      created_at: string;
    }
  >();
  for (const r of (respRaw ?? []) as Array<{
    lead_id: string;
    response_type: 'interested' | 'pass' | 'accepted' | 'declined_by_user';
    proposed_fee: string | null;
    message: string | null;
    created_at: string;
  }>) {
    respMap.set(r.lead_id, r);
  }

  return leads.map((l) => {
    const resp = respMap.get(l.id);
    const accepted = resp?.response_type === 'accepted';
    const firstName = l.contact_name.split(' ')[0] ?? 'Consumer';
    return {
      id: l.id,
      contactNameMasked: accepted ? l.contact_name : `${firstName} (masked)`,
      jurisdictionState: l.jurisdiction_state,
      practiceAreas: l.practice_areas ?? [],
      summary: l.summary,
      budget: l.budget,
      urgency: l.urgency,
      createdAt: l.created_at,
      firmResponse: resp
        ? {
            responseType: resp.response_type,
            proposedFee: resp.proposed_fee,
            message: resp.message,
            createdAt: resp.created_at,
          }
        : null,
      acceptedByConsumer: accepted,
      contactEmail: accepted ? l.contact_email : null,
      contactPhone: accepted ? l.contact_phone : null,
      contactName: accepted ? l.contact_name : null,
    };
  });
}

export async function getFirmLeadForFirm(
  firmId: string,
  leadId: string,
): Promise<FirmLeadForFirm | null> {
  const all = await listFirmLeadsForFirm(firmId);
  return all.find((l) => l.id === leadId) ?? null;
}
