import { createAdminSupabase } from './supabase/admin';

/**
 * Per-state statute-of-limitations defaults for the most common
 * civil claim types. NOT a substitute for jurisdictional research -
 * the table covers the simple cases (no tolling, no special accrual,
 * no minor / disability extensions) and operators are expected to
 * adjust for the actual facts.
 *
 * Lookup table keyed by [state][claim_type] -> years. All values
 * are general-rule statutes from each state's code as of 2026-05.
 * If a claim type is not listed for a state, fall back to the
 * "default" key (typically 2 or 3 years for personal injury, longer
 * for written contracts).
 *
 * The accrual date is the date of injury / breach / discovery (the
 * specific accrual rule depends on the claim and state). The
 * suggestSOL function takes accrual date + state + claim type and
 * returns a suggested due_at, with the suggestion expicitly flagged
 * as "verify with counsel."
 */

export type ClaimType =
  | 'personal_injury'
  | 'property_damage'
  | 'breach_of_written_contract'
  | 'breach_of_oral_contract'
  | 'fraud'
  | 'wrongful_death'
  | 'employment_discrimination'
  | 'wage_hour'
  | 'libel_slander'
  | 'product_liability'
  | 'medical_malpractice'
  | 'legal_malpractice'
  | 'real_property'
  | 'collection';

const SOL: Record<string, Partial<Record<ClaimType, number>>> = {
  default: {
    personal_injury: 2,
    property_damage: 2,
    breach_of_written_contract: 4,
    breach_of_oral_contract: 2,
    fraud: 3,
    wrongful_death: 2,
    employment_discrimination: 2,
    wage_hour: 2,
    libel_slander: 1,
    product_liability: 2,
    medical_malpractice: 2,
    legal_malpractice: 2,
    real_property: 5,
    collection: 4,
  },
  CA: {
    personal_injury: 2,
    property_damage: 3,
    breach_of_written_contract: 4,
    breach_of_oral_contract: 2,
    fraud: 3,
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 1, // 3 years from injury / 1 year from discovery, whichever first
    legal_malpractice: 1, // also 4 years outer
    product_liability: 2,
    collection: 4,
  },
  NY: {
    personal_injury: 3,
    property_damage: 3,
    breach_of_written_contract: 6,
    breach_of_oral_contract: 6,
    fraud: 6, // 6 years OR 2 years from discovery
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 2.5,
    legal_malpractice: 3,
    product_liability: 3,
    collection: 6,
  },
  TX: {
    personal_injury: 2,
    property_damage: 2,
    breach_of_written_contract: 4,
    breach_of_oral_contract: 4,
    fraud: 4,
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 2,
    legal_malpractice: 2,
    product_liability: 2,
    collection: 4,
  },
  FL: {
    personal_injury: 2, // reduced from 4 in 2023
    property_damage: 4,
    breach_of_written_contract: 5,
    breach_of_oral_contract: 4,
    fraud: 4,
    wrongful_death: 2,
    libel_slander: 2,
    medical_malpractice: 2,
    legal_malpractice: 2,
    product_liability: 4,
    collection: 5,
  },
  IL: {
    personal_injury: 2,
    property_damage: 5,
    breach_of_written_contract: 10,
    breach_of_oral_contract: 5,
    fraud: 5,
    wrongful_death: 2,
    libel_slander: 1,
    medical_malpractice: 2,
    legal_malpractice: 2,
    product_liability: 2,
    collection: 10,
  },
};

export type SuggestedDeadline = {
  dueAt: string;
  state: string;
  claimType: ClaimType;
  yearsFromAccrual: number;
  reminder: string;
};

/**
 * Suggest a statute-of-limitations deadline given the date the claim
 * accrued (injury / breach / discovery), the state, and the claim
 * type. Returns the date and a reminder reminding the operator to
 * verify with counsel - tolling, discovery, repose, minor / disability
 * extensions, and notice-of-claim periods all change the answer.
 */
export function suggestSOL(
  accrualDateISO: string,
  state: string,
  claimType: ClaimType,
): SuggestedDeadline | null {
  const stateNorm = state.toUpperCase().replace(/^US-/, '');
  const stateTable = SOL[stateNorm] ?? SOL.default;
  const years = stateTable[claimType] ?? SOL.default[claimType];
  if (years === undefined) return null;
  const accrual = new Date(accrualDateISO);
  if (Number.isNaN(accrual.getTime())) return null;
  const due = new Date(accrual);
  due.setFullYear(due.getFullYear() + Math.floor(years));
  // handle the 2.5-year case
  const fractional = years - Math.floor(years);
  if (fractional > 0) {
    due.setMonth(due.getMonth() + Math.round(fractional * 12));
  }
  return {
    dueAt: due.toISOString(),
    state: stateNorm,
    claimType,
    yearsFromAccrual: years,
    reminder:
      'Suggested SOL deadline based on the general rule. Verify with counsel: tolling, discovery rule, repose, notice-of-claim periods, and minor / disability extensions can shift this materially.',
  };
}

/**
 * Cron-driven sweep that fires notifications when a deadline is
 * 90 / 30 / 7 days out. Idempotent - the alerted_* flags prevent
 * duplicate notifications across cron runs.
 */
export async function sweepDeadlineAlerts(): Promise<{
  scanned: number;
  fired: number;
}> {
  const admin = createAdminSupabase();
  if (!admin) return { scanned: 0, fired: 0 };

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const { data } = await admin
    .from('case_deadlines')
    .select(
      'id, case_id, firm_id, user_id, kind, title, due_at, alerted_90, alerted_30, alerted_7',
    )
    .is('completed_at', null)
    .lte('due_at', new Date(now + 95 * day).toISOString())
    .gt('due_at', new Date(now).toISOString());
  const rows = (data ?? []) as Array<{
    id: string;
    case_id: string;
    firm_id: string | null;
    user_id: string | null;
    kind: string;
    title: string;
    due_at: string;
    alerted_90: boolean;
    alerted_30: boolean;
    alerted_7: boolean;
  }>;

  let fired = 0;
  for (const r of rows) {
    const daysOut = Math.ceil(
      (Date.parse(r.due_at) - now) / day,
    );
    let bucket: '90' | '30' | '7' | null = null;
    if (daysOut <= 7 && !r.alerted_7) bucket = '7';
    else if (daysOut <= 30 && !r.alerted_30) bucket = '30';
    else if (daysOut <= 90 && !r.alerted_90) bucket = '90';
    if (!bucket) continue;

    const flagPatch = {
      ...(bucket === '7' ? { alerted_7: true } : {}),
      ...(bucket === '30' ? { alerted_30: true } : {}),
      ...(bucket === '90' ? { alerted_90: true } : {}),
    };
    await admin
      .from('case_deadlines')
      .update(flagPatch)
      .eq('id', r.id);

    const { createNotification } = await import('./notifications');
    const targetUser = r.user_id;
    const title = `${bucket} day${bucket === '7' ? '' : 's'} until: ${r.title}`;
    const body = `Deadline due ${new Date(r.due_at).toLocaleString()}.`;
    if (targetUser) {
      await createNotification({
        userId: targetUser,
        type: 'case_hearing_reminder',
        title,
        body,
        link: `/cases/${r.case_id}`,
        caseId: r.case_id,
      });
    }
    if (r.firm_id) {
      const { data: members } = await admin
        .from('firm_members')
        .select('user_id, role')
        .eq('firm_id', r.firm_id)
        .in('role', ['owner', 'admin', 'attorney', 'paralegal']);
      for (const m of (members ?? []) as Array<{ user_id: string }>) {
        await createNotification({
          userId: m.user_id,
          type: 'case_hearing_reminder',
          title,
          body,
          link: `/counsel/cases/${r.case_id}`,
          caseId: r.case_id,
        });
      }
    }
    fired += 1;
  }

  return { scanned: rows.length, fired };
}
