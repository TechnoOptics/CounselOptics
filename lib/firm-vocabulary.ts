import type { FirmType } from './firm-types';

/**
 * What a firm of a given type calls things.
 *
 * The owner's complaint was not only that an in-house team is shown surfaces it
 * has no use for. It is that the workspace calls the people that team helps
 * "clients", when they are employees, and calls the work arriving "intake",
 * when it is a request.
 *
 * ONE map, concept to noun, so a page never has to ask what kind of firm it is
 * in. Scattering `firmType === 'corporate' ? ... : ...` across the surface is
 * exactly what this exists to prevent: seventy-four pages of ternaries drift,
 * and the seventy-fifth page forgets.
 *
 * Only `corporate` overrides the base today, because in-house is the only
 * vocabulary the owner named. `government` deliberately keeps the ordinary
 * words - whether a state attorney general's office calls the agency it advises
 * a "client" is a guess, and an invented noun reads worse than a plain one.
 * Adding a column later is a table edit here and nothing else.
 *
 * Pure and I/O-free. The nav consumes it through menuLabelsForType, which
 * produces the href -> label shape lib/menu-config.ts already applies.
 */

export type FirmVocabulary = {
  /** One of the people this team advises. */
  client: string;
  /** All of them. */
  clients: string;
  /** Opening a new piece of work. */
  intake: string;
  /** The subject-matter buckets a workspace organizes itself by. */
  practiceAreas: string;
  /** Everyone holding an account in the workspace, legal team included. */
  directory: string;
  /** The body of open work. */
  caseload: string;
};

const BASE: FirmVocabulary = {
  client: 'Client',
  clients: 'Clients',
  intake: 'New intake',
  practiceAreas: 'Practice areas',
  directory: 'Employees',
  caseload: 'Cases',
};

/**
 * In-house.
 *
 * `directory` moves off "Employees" precisely BECAUSE `clients` moves onto it.
 * /counsel/clients (the roster of people invited into the portal) and
 * /counsel/employees (every account in the workspace) are two different things
 * that would otherwise carry the same word in the same rail, which is worse
 * than the wrong word.
 */
const CORPORATE: FirmVocabulary = {
  client: 'Employee',
  clients: 'Employees',
  intake: 'New request',
  practiceAreas: 'Business areas',
  directory: 'Directory',
  caseload: 'Matters',
};

export const FIRM_VOCABULARY: Record<FirmType, FirmVocabulary> = {
  individual: BASE,
  firm: BASE,
  legal_aid: BASE,
  government: BASE,
  other: BASE,
  corporate: CORPORATE,
};

export function firmVocabulary(firmType: FirmType): FirmVocabulary {
  return FIRM_VOCABULARY[firmType] ?? BASE;
}

/**
 * The rail's labels for a firm of this type, in the same href -> label shape
 * `applyMenuConfig` already reads off MenuConfig.labels. Empty for every type
 * whose vocabulary is the base one, which is what keeps a law firm's rail
 * byte-identical to what it renders today.
 *
 * Kept to the four items where the base word is actually wrong for an in-house
 * team. Renaming more than that would be a restyle rather than a translation.
 */
export function menuLabelsForType(firmType: FirmType): Record<string, string> {
  const v = firmVocabulary(firmType);
  if (v === BASE) return {};
  return {
    '/counsel/clients': v.clients,
    '/counsel/employees': v.directory,
    '/counsel/intake': v.intake,
    '/counsel/cases': v.caseload,
  };
}
