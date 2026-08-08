/**
 * The one rule for what counts as a carried disclosure consent.
 *
 * Split out of lib/signing-handoff.ts, which imports node:crypto and so
 * can never enter a browser bundle. Nothing here touches crypto, I/O or
 * the environment, which is the point: the laptop's own card needs to
 * know whether it is yet holding enough consent to ask for a code, and
 * the only safe way for it to know is to run the same function the mint
 * runs, not a second copy of the rule that agrees until it does not.
 *
 * lib/signing-handoff.ts re-exports everything below, so server callers
 * import it from where they always did.
 */

/**
 * What the laptop genuinely holds when it asks for a code, and nothing
 * else.
 *
 * The signer reads the electronic-records disclosure, ticks its two
 * boxes and confirms they have read the document on the laptop, before
 * the capture step opens and before any code is offered. Those
 * affirmations are real, they are the signer's own, and they are
 * timestamped at the moment they were made. Without carrying them a
 * mobile-signed row records no disclosure at all, which would make the
 * QR path the one route to a signature with a thinner record behind it
 * than every other route.
 *
 * What is deliberately NOT here is the intent affirmation, the user
 * agent and the timezone offset. Those describe the device that makes
 * the mark, and the mark is made on the phone. Copying the laptop's
 * across would be asserting that a device did something it did not do.
 */
export type DesktopDisclosureConsent = {
  electronicRecordsConsentedAt: string;
  hardwareSoftwareConfirmedAt: string | null;
  documentPresented: boolean;
  documentReviewedAt: string | null;
};

/** The loose shape a browser or a stored jsonb blob may present. */
export type DesktopDisclosureConsentInput = {
  electronicRecordsConsentedAt?: unknown;
  hardwareSoftwareConfirmedAt?: unknown;
  documentPresented?: unknown;
  documentReviewedAt?: unknown;
};

function instant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}

/**
 * Validate a disclosure capture, in both directions.
 *
 * The same function normalises what the laptop sends to the mint action
 * and what comes back out of the stored jsonb, so there is one parser
 * rather than a writer and a reader that can disagree about what a
 * stored blob means.
 *
 * Returning null means "no evidence of consent", which the mint side
 * treats as a refusal. It is not a forgery check: a caller can invent a
 * timestamp exactly as the ordinary desktop submit can, and this claims
 * nothing more than that path already claims. It is a completeness
 * check, so the QR can never produce a signature record with less in it
 * than the pad on the same page would.
 *
 * documentReviewedAt is dropped unless documentPresented is true. The
 * desktop goes to some trouble to freeze that pair together, because a
 * review affirmation next to a document that was never shown reads, to
 * anyone auditing it later, as a signer affirming they read something
 * they were not given.
 */
export function desktopConsentForHandoff(
  input: DesktopDisclosureConsentInput | null | undefined,
): DesktopDisclosureConsent | null {
  if (!input || typeof input !== 'object') return null;

  const electronicRecordsConsentedAt = instant(input.electronicRecordsConsentedAt);
  if (!electronicRecordsConsentedAt) return null;

  const documentPresented = input.documentPresented === true;

  return {
    electronicRecordsConsentedAt,
    hardwareSoftwareConfirmedAt: instant(input.hardwareSoftwareConfirmedAt),
    documentPresented,
    documentReviewedAt: documentPresented
      ? instant(input.documentReviewedAt)
      : null,
  };
}

/**
 * May the laptop ask for a code yet?
 *
 * The same question the mint answers, asked before the signer presses
 * anything, so the card can offer the option from the first screen while
 * nothing is minted until there is a consent to carry. It is defined as
 * the mint's own check rather than beside it: if that check ever
 * loosens or tightens, this moves with it.
 */
export function handoffCodeAvailable(
  consent: DesktopDisclosureConsentInput | null | undefined,
): boolean {
  return desktopConsentForHandoff(consent) !== null;
}
