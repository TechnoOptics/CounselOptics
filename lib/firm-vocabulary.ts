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

/**
 * WHOLE SENTENCES, not nouns glued into them.
 *
 * The nouns above rename a heading. They cannot rewrite a sentence, and the
 * roster and the dashboard are made of sentences. Three things break when a
 * noun is substituted into running copy:
 *
 *   - The indefinite article. "a client" and "an employee" disagree, and
 *     `a ${v.client}` prints "a employee" the day somebody adds a
 *     vowel-initial word to the map.
 *   - Case. A sentence needs "clients", a heading needs "Clients", and
 *     `.toLowerCase()` scattered through JSX is how one of them ends up
 *     capitalized mid-sentence.
 *   - Translation. `<T>` matches a whole phrase against the dictionary. A
 *     sentence assembled from fragments at render time matches nothing, so
 *     every substituted string silently drops out of the translated set.
 *
 * So each surface's copy is written out twice, in full, and the page picks a
 * record. That is more characters than interpolation and it is the reason the
 * result reads like it was written for an in-house team rather than
 * search-and-replaced at one.
 *
 * Everything here is a literal. Nothing a firm types can reach this map, which
 * is what lets these values sit inside `<T>` under the counsel i18n guard.
 */
export type FirmCopy = {
  /** /counsel/clients page title. */
  rosterTitle: string;
  /** The sentence under it, after the count. */
  rosterBlurb: string;
  /** The segmented view strip's accessible label. */
  rosterViews: string;
  /** Empty roster. */
  rosterEmpty: string;
  /** Empty roster, to somebody who may invite. */
  rosterEmptyCanInvite: string;
  /** Empty roster, to somebody who may not. */
  rosterEmptyCannotInvite: string;
  /** "3 clients at Bell Kerr." - the noun, singular and plural. */
  rosterCountOne: string;
  rosterCountMany: string;
  /** The dashboard roster tile's body line. */
  tileRosterBody: string;
  /** "Assigned to me": the heading over the person's own roster column. */
  assignedRoster: string;
  /** ... and its two empty states. */
  assignedRosterEmpty: string;
  assignedCasesEmpty: string;
  /** "Assigned to me" when the person has nothing at all. */
  assignedNothing: string;
  /** The invite form above the roster: its heading, its error, its example. */
  inviteHeading: string;
  inviteFailed: string;
  inviteEmailExample: string;
  /** The intake page's eyebrow and subtitle. The subtitle names what the
   *  conflict check runs over, which differs by type. */
  intakeEyebrow: string;
  intakeBlurb: string;
  /** The matter-collaborator role for the person the matter is FOR. */
  matterRoleLabel: string;
  matterRoleBlurb: string;
  /** The prompt over an empty collaborator list. */
  matterInviteHint: string;
  /** Ask Advottic: the suggestion and the placeholder that name a person. */
  askSuggestion: string;
  askPlaceholder: string;
  /** The matter list's two search boxes. */
  searchMattersHint: string;
  searchTitleHint: string;
  /*
   * NO documentSignedBy. The document status table already distinguishes
   * `signed_client` ("Signed by client") from `signed_employee` ("Signed by
   * firm employee (internal HR)"). Renaming the first to "Signed by employee"
   * for an in-house team would collide with the second and make two distinct
   * states read identically, so that word stays put on every type. An outside
   * client signing an in-house team's contract is still a client.
   */
  /** The example under the practice/business areas field. */
  areasExample: string;
};

const BASE_COPY: FirmCopy = {
  rosterTitle: 'Client roster',
  rosterBlurb:
    'Invite a client by email. They get a regular Advottic account; this firm gains view and collaborate access on cases they share.',
  rosterViews: 'Client views',
  rosterEmpty: 'No clients yet.',
  rosterEmptyCanInvite: 'Use the invite form above to add your first client.',
  rosterEmptyCannotInvite:
    'An owner, admin, or attorney at the firm can invite the first client.',
  rosterCountOne: 'client at',
  rosterCountMany: 'clients at',
  tileRosterBody: 'Invite a client and they stay linked to your firm.',
  assignedRoster: 'Your clients',
  assignedRosterEmpty: 'No primary-attorney clients.',
  assignedCasesEmpty: 'No cases tied to your clients yet.',
  assignedNothing:
    "When you're set as the primary attorney on a client or case, it'll show up here for quick access.",
  inviteHeading: 'Invite a client',
  inviteFailed: 'Could not invite client.',
  inviteEmailExample: 'client@example.com',
  intakeEyebrow: 'Counsel · intake',
  intakeBlurb:
    'Open a new request for everything legal handles - outside-client matters, contracts, internal reviews, document safekeeping, trademark/IP, NDAs, compliance, and more. Pick a request type, capture the parties, and the conflict check runs across your prior matters and client list.',
  matterRoleLabel: 'Represented party (client)',
  matterRoleBlurb:
    'Your client. Can view the matter and contribute their own evidence and statements.',
  matterInviteHint: 'Invite your client, co-counsel, or a contributor.',
  askSuggestion: 'What did we last discuss with this client?',
  askPlaceholder: 'Ask Advottic anything - a law, a case, a clause, a client, a meeting…',
  searchMattersHint: 'Search title, client, matter type, assignee',
  searchTitleHint: 'Title or client',
  areasExample: 'e.g., Family, Estate planning',
};

/**
 * In-house.
 *
 * "Invite" survives: an in-house team does invite an employee into the portal,
 * and the mechanism is the same one. What does not survive is "client", the
 * suggestion that the relationship is external, and "primary attorney", which
 * is a law-firm assignment convention rather than a corporate one.
 */
const CORPORATE_COPY: FirmCopy = {
  rosterTitle: 'Employee roster',
  rosterBlurb:
    'Invite an employee by email. They get a regular Advottic account; your team gains view and collaborate access on the matters they raise.',
  rosterViews: 'Employee views',
  rosterEmpty: 'No employees yet.',
  rosterEmptyCanInvite: 'Use the invite form above to add your first employee.',
  rosterEmptyCannotInvite:
    'An owner, admin, or attorney on the team can invite the first employee.',
  rosterCountOne: 'employee at',
  rosterCountMany: 'employees at',
  tileRosterBody: 'Invite an employee and they stay linked to your team.',
  assignedRoster: 'Your employees',
  assignedRosterEmpty: 'Nobody is assigned to you yet.',
  assignedCasesEmpty: 'No matters tied to your employees yet.',
  assignedNothing:
    "When an employee or a matter is assigned to you, it'll show up here for quick access.",
  inviteHeading: 'Invite an employee',
  inviteFailed: 'Could not invite that employee.',
  inviteEmailExample: 'employee@company.com',
  // "outside-client matters" survives, and deliberately. An in-house team does
  // occasionally open one, the request-type dropdown still offers it, and the
  // conflict check does run over prior matters. What changes is that the list
  // it runs over is the employee roster, not a client list.
  intakeEyebrow: 'Legal · requests',
  intakeBlurb:
    'Open a new request for everything legal handles - contracts, internal reviews, document safekeeping, trademark/IP, NDAs, compliance, outside-client matters, and more. Pick a request type, capture the parties, and the conflict check runs across your prior matters and employee roster.',
  matterRoleLabel: 'Represented party (employee)',
  matterRoleBlurb:
    'The employee this matter is for. Can view it and contribute their own evidence and statements.',
  matterInviteHint: 'Invite the employee, co-counsel, or a contributor.',
  askSuggestion: 'What did we last discuss with this employee?',
  askPlaceholder: 'Ask Advottic anything - a law, a matter, a clause, an employee, a meeting…',
  searchMattersHint: 'Search title, employee, matter type, assignee',
  searchTitleHint: 'Title or employee',
  areasExample: 'e.g., Employment, Commercial, IP',
};

export const FIRM_COPY: Record<FirmType, FirmCopy> = {
  individual: BASE_COPY,
  firm: BASE_COPY,
  legal_aid: BASE_COPY,
  government: BASE_COPY,
  other: BASE_COPY,
  corporate: CORPORATE_COPY,
};

export function firmCopy(firmType: FirmType): FirmCopy {
  return FIRM_COPY[firmType] ?? BASE_COPY;
}
