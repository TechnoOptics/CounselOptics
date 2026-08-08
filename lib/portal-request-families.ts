/**
 * What an employee can actually ask the legal team for, and the four
 * groups the portal home offers those things in.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The request types were a const array inside a 'use client' component,
 * which meant the only way to know what an employee can file was to
 * read a React file, and nothing could assert anything about the list.
 * The portal home now offers four tiles over the same list, and a tile
 * whose group does not match the form it opens is exactly the class of
 * defect this product keeps shipping. So the list and the grouping live
 * together in one plain module that the form, the home page, the
 * requests list and the test suite all read.
 *
 * WHAT IS BEHIND EACH TILE
 * ------------------------
 * Nothing here is a new feature. Every family is a set of values that
 * already go into `firm_matter_intakes.matter_type`, filed through the
 * intake form that already exists, tracked on the list that already
 * exists. A tile is a filtered view of one queue, which is what a
 * request desk is: the four are not four systems.
 *
 * The split between `internal` and `legal` is the one that needed a
 * reason rather than a label. Both go to the same legal team, so
 * "internal" cannot mean "not legal". It means the work stays inside
 * the company: a document, a policy question, a personnel matter.
 * `legal` is the work that FACES OUT: a filing, a hold, a letter to
 * somebody else. An employee can tell those apart without being told
 * what a matter type is, which is the only test that counts here.
 *
 * THE PARTITION IS TOTAL, AND THE TEST HOLDS IT THERE
 * --------------------------------------------------
 * Every in-house request type belongs to exactly one family. That is
 * not a nicety: the home tiles count an employee's open requests per
 * family, and a type in no family would be an open request that no
 * tile ever mentions, so the page would quietly under-report. Adding a
 * type to REQUEST_TYPES without placing it fails
 * tests/portal-request-families.test.ts.
 */

/**
 * Which shape the intake form takes. `client` is an outside-client
 * matter and only the legal team files those; everything else is the
 * in-house flow.
 */
export type IntakeMode = 'client' | 'inhouse';

export type RequestType = {
  /** Written verbatim to `firm_matter_intakes.matter_type`. */
  value: string;
  /** What the dropdown says. */
  label: string;
  mode: IntakeMode;
};

/**
 * Every request type, in the order the dropdown offers them.
 *
 * `value` is stored, so changing one orphans every request already
 * filed under the old string. Change `label` instead.
 */
export const REQUEST_TYPES: RequestType[] = [
  { value: 'New case / matter', label: 'New case / matter (outside client)', mode: 'client' },
  { value: 'New contract / agreement', label: 'New contract / agreement', mode: 'inhouse' },
  { value: 'Internal review request', label: 'Internal review request', mode: 'inhouse' },
  { value: 'Document for safekeeping', label: 'Document submission for safekeeping', mode: 'inhouse' },
  { value: 'Trademark / IP filing', label: 'Trademark / IP filing', mode: 'inhouse' },
  { value: 'NDA review', label: 'NDA review', mode: 'inhouse' },
  { value: 'Vendor / MSA review', label: 'Vendor / MSA review', mode: 'inhouse' },
  { value: 'Employment matter', label: 'Employment matter', mode: 'inhouse' },
  { value: 'Compliance question', label: 'Compliance question', mode: 'inhouse' },
  { value: 'Litigation hold', label: 'Litigation hold', mode: 'inhouse' },
  { value: 'Demand letter', label: 'Demand letter', mode: 'inhouse' },
  { value: 'Other', label: 'Other', mode: 'inhouse' },
];

export type PortalFamilyKey = 'internal' | 'contract' | 'legal' | 'dropbox';

export type PortalRequestFamily = {
  key: PortalFamilyKey;
  /** The tile heading. The owner named these four and this order. */
  title: string;
  /**
   * The mono chip on the tile.
   *
   * It is the family key in upper case, which is also the `family`
   * value in the URL the tile links to. It is a real handle on a real
   * thing, not a reference number the product does not issue: a matter
   * intake has no human-facing number, and inventing one on a tile
   * would be the same lie as an empty control.
   */
  code: string;
  /** Two lines on the tile. Both have to be true of the form it opens. */
  blurb: string;
  /** The request types this family covers, verbatim from REQUEST_TYPES. */
  types: string[];
  /** The verb the tile uses when this person has nothing open here. */
  startLabel: string;
};

export const PORTAL_REQUEST_FAMILIES: PortalRequestFamily[] = [
  {
    key: 'internal',
    title: 'Internal request',
    code: 'INTERNAL',
    blurb:
      'Have legal look at something that stays inside the company. A draft, a policy question, a personnel matter.',
    types: ['Internal review request', 'Compliance question', 'Employment matter'],
    startLabel: 'Ask legal to review',
  },
  {
    key: 'contract',
    title: 'Contract review',
    code: 'CONTRACT',
    blurb:
      'Send an agreement to legal before you sign it. New contracts, NDAs, and vendor or MSA paperwork.',
    types: ['New contract / agreement', 'NDA review', 'Vendor / MSA review'],
    startLabel: 'Send a contract',
  },
  {
    key: 'legal',
    title: 'Legal request',
    code: 'LEGAL',
    blurb:
      'Ask legal to act outside the company. A filing, a hold on records, a letter to another party.',
    types: ['Trademark / IP filing', 'Litigation hold', 'Demand letter', 'Other'],
    startLabel: 'Start a request',
  },
  {
    key: 'dropbox',
    title: 'Legal drop box',
    code: 'DROPBOX',
    blurb:
      'Hand a signed or executed document to legal for safekeeping. Attach the file and it is on the record.',
    types: ['Document for safekeeping'],
    startLabel: 'Drop off a document',
  },
];

/** The types an employee may file. Outside-client matters are not theirs. */
export function employeeRequestTypes(): RequestType[] {
  return REQUEST_TYPES.filter((r) => r.mode === 'inhouse');
}

/** A family by key, or null for anything that is not one of the four. */
export function familyByKey(
  key: string | null | undefined,
): PortalRequestFamily | null {
  return (
    PORTAL_REQUEST_FAMILIES.find((f) => f.key === (key ?? '').trim()) ?? null
  );
}

/**
 * The family a stored `matter_type` belongs to.
 *
 * Returns null rather than guessing. A request filed before a type was
 * renamed, or one the legal team filed as an outside-client matter and
 * invited the employee onto, belongs to no tile, and saying so is what
 * keeps the tile counts honest: "everything" is still the full list.
 */
export function familyOfType(
  matterType: string | null | undefined,
): PortalRequestFamily | null {
  const t = (matterType ?? '').trim();
  if (!t) return null;
  return PORTAL_REQUEST_FAMILIES.find((f) => f.types.includes(t)) ?? null;
}

/**
 * The types the intake form should offer, given a `family` query
 * parameter that came off a URL and is therefore untrusted.
 *
 * An unknown family is not an error and not an empty dropdown: it
 * falls back to every in-house type, which is what the form offered
 * before any of this existed.
 */
export function requestTypesForFamily(
  familyKey: string | null | undefined,
): RequestType[] {
  const family = familyByKey(familyKey);
  if (!family) return employeeRequestTypes();
  const inFamily = employeeRequestTypes().filter((r) =>
    family.types.includes(r.value),
  );
  return inFamily.length > 0 ? inFamily : employeeRequestTypes();
}
