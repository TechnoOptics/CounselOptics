/**
 * Which consumer account route a FIRM user should be sent to instead, and
 * the one marker that says "no, I meant the consumer page".
 *
 * The problem this solves is a bookmark. The counsel account menu was
 * repointed at /counsel/profile and /counsel/feedback, but a firm user who
 * saved /profile before that, or who reaches it from the MFA page, still
 * lands in the consumer shell: the cream chrome, the consumer sidebar and
 * the marketing footer. A menu fix does not reach them, because a bookmark
 * outlives a menu.
 *
 * THE RULE, and the part of it that is a judgement call:
 *
 *   1. Only firm MEMBERSHIP moves anyone. A user with no firm_members row is
 *      never redirected, so a consumer can never be pushed into counsel. A
 *      co-counsel guest has no membership either and so is never moved: their
 *      account surface is /counsel/guest/profile, a deliberate subset, not
 *      the firm account page.
 *   2. `?personal=1` always wins. It is the deliberate-consumer marker, and
 *      it is a stable URL, so a firm member who wants the consumer profile
 *      can bookmark THAT and keep it.
 *   3. The counsel account page links to the consumer profile at that URL, so
 *      nothing this redirect covers becomes unreachable. That matters because
 *      /counsel/profile is a strict subset: Safe Witness, theme, language,
 *      Wear OS, install and the personal arbitration record live only on the
 *      consumer page.
 *
 * What CANNOT be told apart reliably, stated rather than guessed: whether a
 * firm member typing /profile means their personal account or their firm one.
 * Nothing is stored anywhere that records "this person is in consumer mode" -
 * profiles.active_firm_id says which firm is active, not which product is in
 * use, and the persona switcher in lib/persona.ts covers the employee portal,
 * not consumer-versus-counsel. So the default goes to the case the firm owner
 * actually complained about, and the exception is given an explicit URL
 * instead of being inferred. If a stored mode is ever added, this is the one
 * function that has to change.
 *
 * Kept pure and dependency-free so the policy can be exercised directly in
 * tests. The membership read stays at the call site.
 */

/** Consumer account route -> its counsel equivalent. */
export const COUNSEL_ACCOUNT_EQUIVALENT: Readonly<Record<string, string>> = {
  '/profile': '/counsel/profile',
  '/profile/api-tokens': '/counsel/profile/api-tokens',
  '/feedback': '/counsel/feedback',
};

/** `?personal=1` on a consumer account route means "leave me here". */
export const PERSONAL_OVERRIDE_PARAM = 'personal';

/** The bookmarkable URL that always renders the consumer profile. */
export const PERSONAL_PROFILE_HREF = `/profile?${PERSONAL_OVERRIDE_PARAM}=1`;

/**
 * Where to send this request, or null to render the consumer page.
 *
 * `isFirmMember` is the caller's own resolved membership (listMyFirms().
 * length > 0). `searchParams` is the page's raw searchParams object.
 */
export function counselAccountRedirect(
  pathname: string,
  isFirmMember: boolean,
  searchParams?: Record<string, string | string[] | undefined>,
): string | null {
  if (!isFirmMember) return null;
  if (wantsPersonal(searchParams)) return null;
  return COUNSEL_ACCOUNT_EQUIVALENT[pathname] ?? null;
}

/** True when the request carries the deliberate-consumer marker. */
export function wantsPersonal(
  searchParams?: Record<string, string | string[] | undefined>,
): boolean {
  const raw = searchParams?.[PERSONAL_OVERRIDE_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === '1' || value === 'true';
}
