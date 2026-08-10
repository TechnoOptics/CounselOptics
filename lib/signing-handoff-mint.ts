import {
  desktopConsentForHandoff,
  handoffQrUrl,
  HANDOFF_TTL_MINUTES,
  type DesktopDisclosureConsent,
  type DesktopDisclosureConsentInput,
} from './signing-handoff';
import type { SignatureMethod } from './signature-methods';

/**
 * Everything that decides whether a QR may be minted.
 *
 * It lives here, away from the server action that calls it, because a
 * 'use server' export is a public HTTP endpoint and the guards in front
 * of a public endpoint are the part worth exercising. Nothing in this
 * file touches a database, an environment variable or a request: the
 * lookup, the insert and the encoder all arrive as functions, so every
 * refusal below is reachable in a unit test without a Supabase project
 * and without pretending a grep over the source is a test.
 *
 * The order of the checks is the order the signer would want to be told
 * about them. A row that is already signed says so, rather than being
 * refused for a missing disclosure it no longer needs.
 */

export type MintSignatureRow = {
  id: string;
  signedAt: string | null;
  accessCodeHash: string | null;
  accessCodeVerifiedAt: string | null;
  /** Set when the signer already declined or asked for changes. */
  response: 'rejected' | 'changes_requested' | null;
  /**
   * The parent request's frozen signature_methods. Null means no restriction,
   * which is what every request created before 20260814_signature_methods.sql
   * means and what a database without that migration reports.
   */
  signatureMethods?: SignatureMethod[] | null;
};

export type MintHandoffDeps = {
  /** Absolute origin the QR should point at. */
  origin: string;
  /** Resolve the signature from the durable signer token. */
  loadSignature: (signerToken: string) => Promise<MintSignatureRow | null>;
  createHandoff: (
    signatureId: string,
    consent: DesktopDisclosureConsent,
  ) => Promise<{ ok: true; rawToken: string } | { ok: false }>;
  /** Encode the handoff URL as inline SVG, on our own server. */
  encode: (url: string) => string;
};

/**
 * The lifetime travels with the code so the screen showing it does not
 * have to hold a second copy of HANDOFF_TTL_MINUTES. lib/signing-handoff
 * imports node:crypto and cannot be pulled into a browser bundle, and a
 * constant retyped in the client is a constant that drifts.
 */
export type MintHandoffResult =
  | { ok: true; svg: string; expiresInSeconds: number }
  | { ok: false; error: string };

/**
 * Everything a signer might be told, in one place, so the wording of a
 * refusal is reviewable next to the reason for it.
 *
 * Unlike the phone's refusals these may differ from one another. The
 * phone's have to be indistinguishable because a stranger could be
 * holding it; this side is only ever read by someone who already holds
 * the durable signing link, so telling them plainly what is wrong costs
 * nothing and saves them guessing.
 */
export const MINT_REFUSAL_UNAVAILABLE =
  'Mobile signing is not available right now. You can sign on this page instead.';

export const MINT_REFUSAL_LINK_INVALID = 'This link is no longer valid.';

export const MINT_REFUSAL_ALREADY_SIGNED =
  'This document has already been signed.';

export const MINT_REFUSAL_ON_HOLD =
  'This signing link is on hold. Ask the firm for a new request.';

export const MINT_REFUSAL_ACCESS_CODE =
  'Enter the access code from your email first.';

export const MINT_REFUSAL_PHONE_NOT_ALLOWED =
  'This document cannot be signed on a phone. Please sign on this page instead.';

export const MINT_REFUSAL_DISCLOSURE =
  'Please complete the disclosure step on this page first.';

export async function mintSigningHandoff(
  signerToken: string,
  consentInput: DesktopDisclosureConsentInput | null | undefined,
  deps: MintHandoffDeps,
): Promise<MintHandoffResult> {
  const token = typeof signerToken === 'string' ? signerToken.trim() : '';
  if (!token) return { ok: false, error: MINT_REFUSAL_LINK_INVALID };

  const sig = await deps.loadSignature(token);
  if (!sig) return { ok: false, error: MINT_REFUSAL_LINK_INVALID };

  if (sig.signedAt) return { ok: false, error: MINT_REFUSAL_ALREADY_SIGNED };
  if (sig.response) return { ok: false, error: MINT_REFUSAL_ON_HOLD };

  // The handoff must never be a way around the access-code gate. An
  // external signer was emailed a code; until it has been entered on
  // this page, this caller has shown only that they hold the link.
  if (sig.accessCodeHash && !sig.accessCodeVerifiedAt) {
    return { ok: false, error: MINT_REFUSAL_ACCESS_CODE };
  }

  // Did the firm allow signing on a phone at all?
  //
  // Defence in depth, and it says so. lib/signature-write.ts refuses a
  // mobile_handoff signature on a request that forbids the phone whatever
  // happens here, and that refusal is the one protecting the instrument. This
  // one exists because a signer who scans a code, walks to another device,
  // draws their name and is only then told is being wasted twice.
  //
  // Undefined reads as unrestricted, deliberately: an adapter that has not
  // been taught to load the column yet must not thereby refuse every handoff.
  const allowed = sig.signatureMethods ?? null;
  if (allowed !== null && !allowed.includes('phone')) {
    return { ok: false, error: MINT_REFUSAL_PHONE_NOT_ALLOWED };
  }

  // The ordering that makes this feature safe, enforced rather than
  // assumed. The code is offered from the capture step, which the
  // signer only reaches by consenting to the disclosure, so a caller
  // with no disclosure to carry is not at that point in the ceremony.
  // Refusing here also means a mobile-signed row can never carry less
  // consent evidence than a laptop-signed one.
  const consent = desktopConsentForHandoff(consentInput);
  if (!consent) return { ok: false, error: MINT_REFUSAL_DISCLOSURE };

  const made = await deps.createHandoff(sig.id, consent);
  if (!made.ok) return { ok: false, error: MINT_REFUSAL_UNAVAILABLE };

  try {
    // Only the handoff token is ever encoded. The durable signer token
    // arrived as an argument, proved the caller is the signer, and goes
    // no further than the lookup above.
    return {
      ok: true,
      svg: deps.encode(handoffQrUrl(deps.origin, made.rawToken)),
      expiresInSeconds: HANDOFF_TTL_MINUTES * 60,
    };
  } catch {
    // A misconfigured origin or text the encoder cannot fit. Either way
    // there is nothing scannable to show, and the pad is on the same
    // screen, so this is a refusal rather than a broken image.
    return { ok: false, error: MINT_REFUSAL_UNAVAILABLE };
  }
}
