import { createAdminSupabase } from './supabase/admin';

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/**
 * The matter a lead was opened into, when that link can be read at all.
 *
 * `supported: false` means the `firm_leads.case_id` column is not on this
 * deployment yet (the migration that adds it is applied by the owner). It is
 * kept apart from "no matter yet" on purpose: without the column there is no
 * way to tell a first conversion from a fifth, so the surface hides the
 * control rather than offering one that would open a duplicate matter every
 * time it is pressed.
 */
export type LeadCaseLink =
  | { supported: true; caseId: string | null }
  | { supported: false };

export async function readLeadCaseLink(
  admin: AdminClient,
  leadId: string,
): Promise<LeadCaseLink> {
  const { data, error } = await admin
    .from('firm_leads')
    .select('case_id')
    .eq('id', leadId)
    .maybeSingle();
  if (error) return { supported: false };
  return {
    supported: true,
    caseId: (data as { case_id?: string | null } | null)?.case_id ?? null,
  };
}

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
  /** The matter this lead was opened into, when the link can be read. */
  caseLink: LeadCaseLink;
};

/**
 * Lead readout for the firm-side inbox. Until the consumer accepts
 * the firm's "interested" response, the contact channels stay
 * masked - the firm sees enough to decide whether to take the
 * matter, no more.
 *
 * A lead this firm has been ACCEPTED on is read back too, and that is not a
 * widening of what the firm may see. Accepting is what reveals the contact
 * details in the first place, and acceptFirmAction closes the lead in the same
 * breath: it writes `firm_leads.status = 'closed'`. So the status filter below
 * used to drop every accepted lead, which meant the "Contact details unlocked"
 * panel could never render and the "Lead accepted you - open the lead" notice
 * the same action sends firm members pointed at a page that answered 404. The
 * jurisdiction and practice-area match is skipped for those leads for the same
 * reason: the relationship already exists, and a firm that has since edited its
 * practice areas must not lose the client it was chosen by.
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

  // Responses this firm has made, read FIRST because the accepted ones decide
  // which leads are readable at all.
  const { data: respRaw } = await admin
    .from('firm_lead_responses')
    .select('lead_id, response_type, proposed_fee, message, created_at')
    .eq('firm_id', firmId);
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
  const acceptedLeadIds = Array.from(respMap.entries())
    .filter(([, r]) => r.response_type === 'accepted')
    .map(([leadId]) => leadId);

  type LeadRow = {
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
  };
  const LEAD_COLUMNS =
    'id, contact_name, contact_email, contact_phone, jurisdiction_state, practice_areas, summary, budget, urgency, status, created_at';

  // Leads in any of the firm's states.
  const { data: leadsRaw } = await admin
    .from('firm_leads')
    .select(LEAD_COLUMNS)
    .in('status', ['open', 'matched'])
    .order('created_at', { ascending: false });
  const matched = ((leadsRaw ?? []) as LeadRow[]).filter((l) => {
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

  // The leads this firm was chosen on, whatever their status now is.
  let acceptedLeads: LeadRow[] = [];
  if (acceptedLeadIds.length > 0) {
    const { data: acceptedRaw } = await admin
      .from('firm_leads')
      .select(LEAD_COLUMNS)
      .in('id', acceptedLeadIds)
      .order('created_at', { ascending: false });
    acceptedLeads = (acceptedRaw ?? []) as LeadRow[];
  }

  const byId = new Map<string, LeadRow>();
  for (const l of [...matched, ...acceptedLeads]) byId.set(l.id, l);
  const leads = Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  if (leads.length === 0) return [];

  // Which of these have already been opened into a matter. One query for the
  // whole page, and tolerant of the column not existing yet (see LeadCaseLink).
  const { data: linkRaw, error: linkError } = await admin
    .from('firm_leads')
    .select('id, case_id')
    .in(
      'id',
      leads.map((l) => l.id),
    );
  const linkSupported = !linkError;
  const linkMap = new Map<string, string | null>();
  for (const row of (linkRaw ?? []) as Array<{
    id: string;
    case_id: string | null;
  }>) {
    linkMap.set(row.id, row.case_id ?? null);
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
      caseLink: linkSupported
        ? { supported: true, caseId: linkMap.get(l.id) ?? null }
        : { supported: false },
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
