/**
 * Court-form registry. Each entry maps a standardized court form
 * (CA Judicial Council, NY UCS, federal AO, state-specific) to:
 *   - The PDF location (a static asset path or a URL we can fetch)
 *   - A field map that translates case data into the PDF AcroForm
 *     field names
 *   - The state + form type metadata
 *
 * The actual PDF-fill happens in lib/court-forms-fill.ts when
 * pdf-lib is installed; this registry is the data layer + a stable
 * API surface that the firm-side UI talks to.
 *
 * Adding a new form: append to FORM_REGISTRY with the field map.
 * Most maps are 30-80 fields; we keep the long ones in their own
 * files under lib/court-form-maps/<state>-<form-id>.ts and import
 * from there once the registry crosses ~500 lines.
 */

export type FormFieldMap = {
  /** Path expression resolved against the case data passed to fill(). */
  source: string;
  /** Optional transform applied before writing. */
  transform?: 'uppercase' | 'date_short' | 'date_long' | 'currency';
  /** Default value when source is missing. */
  defaultValue?: string;
};

export type CourtForm = {
  id: string;
  state: string;
  category:
    | 'civil'
    | 'family'
    | 'probate'
    | 'small_claims'
    | 'criminal'
    | 'eviction'
    | 'discovery';
  title: string;
  pdfUrl: string;
  description: string;
  fields: Record<string, FormFieldMap>;
  /** Date the form's official version was last verified. */
  lastVerified: string;
};

export const FORM_REGISTRY: CourtForm[] = [
  {
    id: 'ca-cm-010',
    state: 'CA',
    category: 'civil',
    title: 'Civil Case Cover Sheet (CM-010)',
    pdfUrl: 'https://courts.ca.gov/sites/default/files/courts/default/2024-08/cm010.pdf',
    description:
      'Filed with every California Superior Court civil complaint. Identifies the case type, complexity, and whether collection.',
    lastVerified: '2026-04-01',
    fields: {
      'AttorneyOrPartyWithoutAttorney': { source: 'attorney.full_label' },
      'AttorneyForName': { source: 'plaintiff.name' },
      'CourtName': { source: 'court.name', transform: 'uppercase' },
      'StreetAddress': { source: 'court.address.street' },
      'CityZip': { source: 'court.address.cityZip' },
      'BranchName': { source: 'court.branch' },
      'CaseNamePlaintiff': { source: 'plaintiff.name' },
      'CaseNameDefendant': { source: 'defendant.name' },
      'CaseNumber': { source: 'case.number', defaultValue: '' },
      'CheckBox-Civil': { source: 'flags.is_civil', defaultValue: 'Yes' },
    },
  },
  {
    id: 'ca-pos-010',
    state: 'CA',
    category: 'civil',
    title: 'Proof of Service of Summons (POS-010)',
    pdfUrl: 'https://courts.ca.gov/sites/default/files/courts/default/2024-08/pos010.pdf',
    description:
      'Confirms personal service of the summons on the defendant. Required before default judgment.',
    lastVerified: '2026-04-01',
    fields: {
      'AttorneyName': { source: 'attorney.full_label' },
      'CourtName': { source: 'court.name', transform: 'uppercase' },
      'CaseName': { source: 'case.title' },
      'CaseNumber': { source: 'case.number' },
      'PartyServed': { source: 'service.party_name' },
      'PersonServing': { source: 'service.process_server.name' },
      'DateOfService': { source: 'service.date', transform: 'date_short' },
      'TimeOfService': { source: 'service.time' },
      'AddressOfService': { source: 'service.address' },
    },
  },
  {
    id: 'ny-rji',
    state: 'NY',
    category: 'civil',
    title: 'Request for Judicial Intervention (RJI)',
    pdfUrl: 'https://www.nycourts.gov/forms/uniform/uniform840.pdf',
    description:
      'Filed with NY Supreme Court / County Court to assign a judge. Required when filing a note-of-issue, motion, or order to show cause.',
    lastVerified: '2026-04-01',
    fields: {
      'IndexNumber': { source: 'case.number' },
      'CountyName': { source: 'court.county', transform: 'uppercase' },
      'CaptionPlaintiff': { source: 'plaintiff.name' },
      'CaptionDefendant': { source: 'defendant.name' },
      'NatureOfAction': { source: 'case.case_type' },
      'PartyFiling': { source: 'attorney.represents' },
      'AttorneyName': { source: 'attorney.full_label' },
      'AttorneyEmail': { source: 'attorney.email' },
    },
  },
  {
    id: 'fed-ao-440',
    state: 'US',
    category: 'civil',
    title: 'Federal Summons (AO 440)',
    pdfUrl: 'https://www.uscourts.gov/sites/default/files/ao440.pdf',
    description:
      'Federal civil summons. Issued by the clerk and served with the complaint per FRCP 4.',
    lastVerified: '2026-04-01',
    fields: {
      'CourtDistrict': { source: 'court.district', transform: 'uppercase' },
      'CaseNumber': { source: 'case.number' },
      'PlaintiffCaption': { source: 'plaintiff.name' },
      'DefendantCaption': { source: 'defendant.name' },
      'DefendantAddress': { source: 'defendant.address' },
      'PlaintiffAttorney': { source: 'attorney.name' },
      'PlaintiffAttorneyAddress': { source: 'attorney.address' },
    },
  },
  {
    id: 'tx-civil-cover',
    state: 'TX',
    category: 'civil',
    title: 'Texas Civil Case Information Sheet',
    pdfUrl: 'https://www.txcourts.gov/media/2167502/civil-case-info-sheet-rev-714.pdf',
    description:
      'Required by Texas Rule of Civil Procedure 78a with every initial filing. Identifies parties, case type, and remedies sought.',
    lastVerified: '2026-04-01',
    fields: {
      'CaseStyle': { source: 'case.title' },
      'Court': { source: 'court.name' },
      'CaseNumber': { source: 'case.number' },
      'NameOfParty': { source: 'plaintiff.name' },
      'PartyType': { source: 'plaintiff.party_type' },
      'AttorneyName': { source: 'attorney.name' },
      'AttorneyBarNumber': { source: 'attorney.bar_number' },
      'CaseType': { source: 'case.case_type' },
    },
  },
  {
    id: 'ca-fl-100',
    state: 'CA',
    category: 'family',
    title: 'Petition - Marriage / Domestic Partnership (FL-100)',
    pdfUrl: 'https://courts.ca.gov/sites/default/files/courts/default/2024-08/fl100.pdf',
    description:
      'California petition for dissolution, legal separation, or nullity of marriage / domestic partnership.',
    lastVerified: '2026-04-01',
    fields: {
      'PetitionerName': { source: 'petitioner.name' },
      'RespondentName': { source: 'respondent.name' },
      'CountyName': { source: 'court.county', transform: 'uppercase' },
      'DateOfMarriage': { source: 'marriage.date', transform: 'date_short' },
      'DateOfSeparation': { source: 'separation.date', transform: 'date_short' },
      'CauseOfAction': { source: 'case.cause' },
      'StatisticalFacts': { source: 'demographics.summary' },
    },
  },
  {
    id: 'fed-ao-121',
    state: 'US',
    category: 'civil',
    title: 'Notice of Filing of Patent / Trademark Action (AO 121)',
    pdfUrl: 'https://www.uscourts.gov/sites/default/files/ao121.pdf',
    description:
      'Federal notice required by 35 USC 290 / 15 USC 1116(c) when a patent or trademark suit is filed. Sent to the USPTO Director.',
    lastVerified: '2026-04-01',
    fields: {
      'DistrictCourt': { source: 'court.district', transform: 'uppercase' },
      'CaseNumber': { source: 'case.number' },
      'DateFiled': { source: 'case.filed_at', transform: 'date_short' },
      'PlaintiffName': { source: 'plaintiff.name' },
      'DefendantName': { source: 'defendant.name' },
      'PatentNumbers': { source: 'ip.patent_numbers' },
      'TrademarkRegistrations': { source: 'ip.trademark_registrations' },
    },
  },
];

export function getCourtForm(id: string): CourtForm | null {
  return FORM_REGISTRY.find((f) => f.id === id) ?? null;
}

export function listCourtFormsForState(state: string): CourtForm[] {
  const norm = state.toUpperCase().replace(/^US-/, '');
  return FORM_REGISTRY.filter(
    (f) => f.state === norm || f.state === 'US',
  );
}

/**
 * Resolve a dot-path expression like "court.address.street" against
 * a nested data object. Returns undefined if any segment is missing.
 */
export function resolvePath(
  data: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}

/**
 * Apply a transform string to a value. Used by fillCourtForm.
 */
export function applyTransform(
  value: unknown,
  transform?: FormFieldMap['transform'],
): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  switch (transform) {
    case 'uppercase':
      return s.toUpperCase();
    case 'date_short': {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    }
    case 'date_long': {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    case 'currency': {
      const n = Number(s);
      if (!Number.isFinite(n)) return s;
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }
    default:
      return s;
  }
}

/**
 * Stage 1 of the fill pipeline: resolve every field's source path
 * against the case data and return the field-name -> value map.
 * The actual PDF mutation lives in lib/court-forms-fill.ts and uses
 * pdf-lib to write back into AcroForm fields.
 */
export function resolveFormValues(
  form: CourtForm,
  data: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, map] of Object.entries(form.fields)) {
    const raw = resolvePath(data, map.source);
    const value = applyTransform(raw, map.transform);
    out[field] = value || map.defaultValue || '';
  }
  return out;
}
