import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The kinds of legal request a firm accepts.
 *
 * `public.firm_request_types` is the live source of truth: twelve
 * seeded defaults per firm, plus one row per partner-app slug that firm
 * has actually used. The employee Hub renders these as tiles, and the
 * intake form renders them in its picker.
 *
 * NOTE ON PROVENANCE. The intake form-builder branch carries the same
 * rules in `lib/form-queries.ts` (listRequestTypes) and
 * `lib/intake-form-fallback.ts` (pickableRequestTypes). Neither file
 * exists on main, so the three rules are restated here rather than
 * re-derived from scratch, under the same name, so that whoever merges
 * the two branches can collapse them without having to work out
 * whether the behaviour matches. The rules are:
 *
 *   1. MODE. 'client' is an outside-client matter and 'inhouse' is an
 *      internal request. An employee only ever files in-house work, so
 *      a client-mode type reaching an employee's tile grid is a bug.
 *   2. HIDDEN. A firm can retire a type without deleting the rows that
 *      reference it. A hidden type never renders.
 *   3. ORDER. `sort_order` ascending, which keeps the canonical twelve
 *      (0..11) ahead of partner-app slugs (100+).
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
export function pickableRequestTypes(
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
 * Returns the seeded twelve when the table is unreachable or empty, so
 * a Hub never renders an empty tile grid because of infrastructure.
 */
export async function listRequestTypes(
  admin: SupabaseClient | null,
  firmId: string,
): Promise<FirmRequestType[]> {
  if (!admin) return SEEDED_REQUEST_TYPES;
  const { data, error } = await admin
    .from('firm_request_types')
    .select('key, label, mode, sort_order, hidden')
    .eq('firm_id', firmId);
  if (error || !data || data.length === 0) return SEEDED_REQUEST_TYPES;
  const rows = normalize(data as Row[]);
  return rows.length > 0 ? rows : SEEDED_REQUEST_TYPES;
}

/** What an employee is allowed to file: in-house, visible, in order. */
export async function listEmployeeRequestTypes(
  admin: SupabaseClient | null,
  firmId: string,
): Promise<FirmRequestType[]> {
  return pickableRequestTypes(await listRequestTypes(admin, firmId), 'inhouse');
}

/**
 * Resolve a `?type=` query parameter against the types an employee may
 * file. Returns null for anything unrecognised, so a hand-typed or
 * stale URL falls back to the form's own default rather than writing a
 * request type the firm does not use. Matches on label first (that is
 * what the tiles link with, and what is stored on the intake) and on
 * key second, so an older link still resolves.
 */
export function resolveRequestType(
  types: FirmRequestType[],
  param: string | undefined,
): FirmRequestType | null {
  const wanted = (param ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return (
    types.find((t) => t.label.toLowerCase() === wanted) ??
    types.find((t) => t.key.toLowerCase() === wanted) ??
    null
  );
}
