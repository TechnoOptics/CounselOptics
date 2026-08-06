import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The kinds of legal request a firm accepts.
 *
 * `public.firm_request_types` is the live source of truth: twelve
 * seeded defaults per firm, plus one row per partner-app slug that firm
 * has actually used. The employee Hub renders these as tiles, and the
 * intake form renders them in its picker.
 *
 * The three rules every reader applies:
 *
 *   1. MODE. 'client' is an outside-client matter and 'inhouse' is an
 *      internal request. An employee only ever files in-house work, so
 *      a client-mode type reaching an employee's tile grid is a bug.
 *   2. HIDDEN. A firm can retire a type without deleting the rows that
 *      reference it. A hidden type never renders.
 *   3. ORDER. `sort_order` ascending, which keeps the canonical twelve
 *      (0..11) ahead of partner-app slugs (100+).
 *
 * NOTE ON NAMING. `feat/intake-form-builder` solves the same problem in
 * `lib/form-queries.ts` (`listRequestTypes`) and
 * `lib/intake-form-fallback.ts` (`pickableRequestTypes`); neither file
 * exists on main. The exports here are DELIBERATELY named differently
 * (`firmRequestTypes` / `employeeRequestTypes`) rather than shadowing
 * those, because the two implementations agree on the three rules but
 * disagree on four things, and a shared name would have made a genuine
 * behavioural conflict look like a duplicate to be deleted:
 *
 *   a. The selector's second argument is a `RequestTypeMode` here and a
 *      boolean `employeeMode` there. TypeScript catches this one.
 *   b. The row type keeps `sortOrder` and `hidden` here; there it is
 *      narrowed to a `PickableType` that drops both. TypeScript will
 *      NOT catch a caller that reads a field the other shape lacks
 *      until that caller is written.
 *   c. This one can return an empty array; the other never does.
 *   d. A row whose `mode` is NULL or unrecognised is DROPPED here and
 *      COERCED to 'inhouse' there. That is the divergence that matters:
 *      coercing means a row nobody classified is offered to every
 *      employee in the firm. Whoever reconciles the branches has to
 *      pick one, and it should be this one.
 */

export type RequestTypeMode = 'client' | 'inhouse';

export type FirmRequestType = {
  key: string;
  label: string;
  mode: RequestTypeMode;
  sortOrder: number;
  hidden: boolean;
};

/**
 * The twelve every firm is seeded with, in seed order.
 *
 * This is a fallback, not a second source of truth: it is what the Hub
 * shows when the request-types table cannot be read (a local database
 * that has not been migrated, or a missing service-role key). Labels
 * match the seeded rows exactly, because the label is what gets written
 * to `firm_matter_intakes.matter_type`.
 */
export const SEEDED_REQUEST_TYPES: FirmRequestType[] = [
  { key: 'new_case_matter', label: 'New case / matter', mode: 'client', sortOrder: 0, hidden: false },
  { key: 'new_contract_agreement', label: 'New contract / agreement', mode: 'inhouse', sortOrder: 1, hidden: false },
  { key: 'internal_review_request', label: 'Internal review request', mode: 'inhouse', sortOrder: 2, hidden: false },
  { key: 'document_for_safekeeping', label: 'Document for safekeeping', mode: 'inhouse', sortOrder: 3, hidden: false },
  { key: 'trademark_ip_filing', label: 'Trademark / IP filing', mode: 'inhouse', sortOrder: 4, hidden: false },
  { key: 'nda_review', label: 'NDA review', mode: 'inhouse', sortOrder: 5, hidden: false },
  { key: 'vendor_msa_review', label: 'Vendor / MSA review', mode: 'inhouse', sortOrder: 6, hidden: false },
  { key: 'employment_matter', label: 'Employment matter', mode: 'inhouse', sortOrder: 7, hidden: false },
  { key: 'compliance_question', label: 'Compliance question', mode: 'inhouse', sortOrder: 8, hidden: false },
  { key: 'litigation_hold', label: 'Litigation hold', mode: 'inhouse', sortOrder: 9, hidden: false },
  { key: 'demand_letter', label: 'Demand letter', mode: 'inhouse', sortOrder: 10, hidden: false },
  { key: 'other', label: 'Other', mode: 'inhouse', sortOrder: 11, hidden: false },
];

/**
 * The three rules, applied in one place so no caller can forget one.
 * Sorting is by `sortOrder` then `label`, so two partner slugs that
 * happen to land on the same order still come out in a stable order
 * rather than whatever the database felt like returning.
 */
export function requestTypesForMode(
  rows: FirmRequestType[],
  mode: RequestTypeMode,
): FirmRequestType[] {
  return rows
    .filter((r) => r.mode === mode && !r.hidden)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

type Row = {
  key: unknown;
  label: unknown;
  mode: unknown;
  sort_order: unknown;
  hidden: unknown;
};

function normalize(rows: Row[]): FirmRequestType[] {
  const out: FirmRequestType[] = [];
  for (const r of rows) {
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    // A row with no label has nothing to render, and a row whose mode is
    // neither of the two known values is not safe to guess at: guessing
    // 'inhouse' would be the guess that puts a client matter in front of
    // an employee. Drop both.
    if (!key || !label) continue;
    if (r.mode !== 'client' && r.mode !== 'inhouse') continue;
    out.push({
      key,
      label,
      mode: r.mode,
      sortOrder: typeof r.sort_order === 'number' ? r.sort_order : 0,
      hidden: r.hidden === true,
    });
  }
  return out;
}

/**
 * Every request type configured for a firm, unfiltered.
 *
 * Falls back to the seeded twelve when the table is unreachable or
 * empty, so a Hub never renders an empty tile grid because of
 * infrastructure. Each way of arriving at that fallback is logged
 * distinctly: a firm whose every row failed validation and a firm whose
 * table could not be read look identical on screen, and without a line
 * saying which, the only way to tell them apart is to go and query the
 * database by hand.
 */
export async function firmRequestTypes(
  admin: SupabaseClient | null,
  firmId: string,
): Promise<FirmRequestType[]> {
  if (!admin) return SEEDED_REQUEST_TYPES;
  const { data, error } = await admin
    .from('firm_request_types')
    .select('key, label, mode, sort_order, hidden')
    .eq('firm_id', firmId);
  if (error) {
    console.error(
      `[request-types] could not read firm_request_types for firm ${firmId}; falling back to the seeded defaults:`,
      error.message,
    );
    return SEEDED_REQUEST_TYPES;
  }
  if (!data || data.length === 0) {
    console.error(
      `[request-types] firm ${firmId} has no rows in firm_request_types; falling back to the seeded defaults`,
    );
    return SEEDED_REQUEST_TYPES;
  }
  const rows = normalize(data as Row[]);
  if (rows.length === 0) {
    console.error(
      `[request-types] all ${data.length} firm_request_types row(s) for firm ${firmId} failed validation (missing key/label, or a mode that is neither 'client' nor 'inhouse'); falling back to the seeded defaults`,
    );
    return SEEDED_REQUEST_TYPES;
  }
  return rows;
}

/** What an employee is allowed to file: in-house, visible, in order. */
export async function employeeRequestTypes(
  admin: SupabaseClient | null,
  firmId: string,
): Promise<FirmRequestType[]> {
  return requestTypesForMode(await firmRequestTypes(admin, firmId), 'inhouse');
}

/**
 * Resolve a `?type=` query parameter against the types an employee may
 * file. Returns null for anything unrecognised, so a hand-typed or
 * stale URL falls back to the form's own default rather than writing a
 * request type the firm does not use. Matches on label first (that is
 * what the tiles link with, and what is stored on the intake) and on
 * key second, so an older link still resolves.
 *
 * The parameter is `string | string[]` because a repeated query key
 * (`?type=a&type=b`) arrives as an array. Flattening happens HERE
 * rather than at the call site: a page that forgot it called `.trim()`
 * on an array, and a server component that throws is a 500 with no
 * fallback, which is the one failure mode this function exists to
 * prevent. First value wins, the same way a browser reads a form.
 */
export function resolveRequestType(
  types: FirmRequestType[],
  param: string | string[] | undefined,
): FirmRequestType | null {
  const first = Array.isArray(param) ? param[0] : param;
  const wanted = (typeof first === 'string' ? first : '').trim().toLowerCase();
  if (!wanted) return null;
  return (
    types.find((t) => t.label.toLowerCase() === wanted) ??
    types.find((t) => t.key.toLowerCase() === wanted) ??
    null
  );
}
