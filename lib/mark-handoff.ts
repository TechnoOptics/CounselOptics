import {
  handoffStateForCookie,
  HANDOFF_TTL_MINUTES,
  type HandoffState,
  type HandoffTimestamp,
} from './signing-handoff';
import type { SignatureMethod } from './signature-methods';

/**
 * The QR handoff for somebody who is already signed in.
 *
 * WHY THIS EXISTS AT ALL, given lib/signing-handoff-mint.ts already mints one.
 *
 * That handoff authorises one action on one row of firm_signatures, and
 * firm_signature_handoffs.signature_id is a NOT NULL foreign key to that
 * table. An employee filling their firm's own template has no such row and
 * will not have one: their mark goes onto a firm_template_submissions row that
 * does not exist yet, or onto a PDF they export and never file at all. There
 * is no signature id to point a handoff at, so the existing table cannot hold
 * one of these. What IS reused is everything above the table: the state
 * machine, both expiry windows, the token minting and hashing, the cookie
 * comparison and the two-message refusal discipline all come from
 * lib/signing-handoff.ts, unchanged, and the phone draws on the same pad.
 *
 * WHAT CROSSES TO THE PHONE, and why it is not a session.
 *
 * The outside signer's phone COMPLETES the signature: it posts, and a row in
 * firm_signatures gains a signed_at. This one cannot and must not. The
 * employee is authenticated by a session, and a code photographed off their
 * screen must never become a second way to hold it. So the phone here is given
 * exactly one capability, in one direction: hand back one PNG. It cannot read
 * the document, cannot read the form, cannot read a mark, cannot learn who the
 * employee is beyond a display name, and cannot cause anything to be filed.
 * The desk session, which is the authenticated party, collects the picture and
 * remains the only thing that submits.
 *
 * That makes this handoff strictly weaker than the signer's, which is the
 * property that made it safe to offer to a signed-in person at all.
 *
 * NO IDENTIFIER OF THE CALLER APPEARS IN THIS FILE. The firm and the user are
 * resolved from the session by the adapter and closed over in `createHandoff`,
 * so there is no argument here that a caller could substitute for somebody
 * else's. The one id this module does take is the template id, and it is
 * looked up rather than trusted: `loadTemplate` is the adapter's, scoped to
 * the session's own firm.
 */

/** Where the phone lands. Outside /portal on purpose: that shell redirects
 *  anyone without a session, and the phone deliberately has none. */
export function markHandoffQrUrl(origin: string, rawToken: string): string {
  const token = rawToken.trim();
  if (!token) throw new Error('mark-handoff: a QR needs a handoff token');

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('mark-handoff: the site origin must be an absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('mark-handoff: the site origin must be http or https');
  }
  const base = origin.trim().replace(/\/+$/, '');
  return `${base}/sign/mark/${encodeURIComponent(token)}`;
}

export type MarkHandoffRow = {
  sessionHash: string | null;
  createdAt: HandoffTimestamp;
  expiresAt: HandoffTimestamp;
  consumedAt: HandoffTimestamp | null;
  /** When the phone handed its mark back. Set once; the handoff is over. */
  markAt: HandoffTimestamp | null;
};

/**
 * The state of a mark handoff, decided by the signer handoff's own function.
 *
 * markAt is passed where a signature's signed_at goes, because it means the
 * same thing to that machine: the thing this token authorised has happened, so
 * nothing further may be done with it. Reusing the function rather than
 * restating its rules is the point; the ordering that keeps a used code
 * indistinguishable from an expired one comes along with it.
 */
export function markHandoffState(
  row: MarkHandoffRow,
  now: HandoffTimestamp,
  rawCookie: string | null,
): HandoffState {
  return handoffStateForCookie(
    {
      tokenHash: '',
      sessionHash: row.sessionHash,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      signatureSignedAt: row.markAt,
    },
    now,
    rawCookie,
  );
}

/**
 * Two messages, for the same reason the signer's phone has two.
 *
 * A used code, an expired code and a code presented by a device that never
 * scanned it all read identically, so a stranger who photographs a screen
 * learns nothing about whether the code was ever live. Do not give each state
 * its own sentence.
 */
export const MARK_HANDOFF_REFUSAL_UNAVAILABLE =
  'This code is no longer valid. On your computer, choose Sign on your phone again.';

export const MARK_HANDOFF_REFUSAL_DONE =
  'Your signature has already gone to your computer. You can close this page.';

export function markHandoffRefusal(state: HandoffState): string {
  return state === 'already-signed'
    ? MARK_HANDOFF_REFUSAL_DONE
    : MARK_HANDOFF_REFUSAL_UNAVAILABLE;
}

// ---------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------

export type MintMarkTemplateRow = {
  id: string;
  name: string;
  /**
   * The template's signature_methods. Undefined means the adapter could not
   * read the column, which is what a database without
   * 20260814_signature_methods.sql reports, and reads as no restriction.
   */
  signatureMethods?: SignatureMethod[] | null;
};

export type MintMarkHandoffDeps = {
  origin: string;
  /** Scoped to the session's own firm by the adapter. */
  loadTemplate: (templateId: string) => Promise<MintMarkTemplateRow | null>;
  /** Closes over the session's firm and user. Takes no identity argument. */
  createHandoff: (
    templateId: string,
  ) => Promise<{ ok: true; rawToken: string; handoffId: string } | { ok: false }>;
  encode: (url: string) => string;
};

export type MintMarkHandoffResult =
  | { ok: true; handoffId: string; svg: string; expiresInSeconds: number }
  | { ok: false; error: string };

export const MARK_MINT_REFUSAL_UNAVAILABLE =
  'Signing on your phone is not available right now. You can sign on this page instead.';

export const MARK_MINT_REFUSAL_NO_TEMPLATE =
  'This form is no longer available. Go back to your forms and open it again.';

export const MARK_MINT_REFUSAL_PHONE_NOT_ALLOWED =
  'This form cannot be signed on a phone. Please sign on this page instead.';

export async function mintMarkHandoff(
  templateId: unknown,
  deps: MintMarkHandoffDeps,
): Promise<MintMarkHandoffResult> {
  const id = typeof templateId === 'string' ? templateId.trim() : '';
  if (!id) return { ok: false, error: MARK_MINT_REFUSAL_NO_TEMPLATE };

  const template = await deps.loadTemplate(id);
  if (!template) return { ok: false, error: MARK_MINT_REFUSAL_NO_TEMPLATE };

  // Did the firm allow a phone on this template?
  //
  // Defence in depth and it says so: lib/template-submissions.ts refuses the
  // submission itself whatever happens here, and that refusal is the one
  // protecting the document. This exists so an employee is not sent to fetch
  // their phone, scan, draw and only then be told.
  //
  // Undefined reads as unrestricted, deliberately. An adapter running against
  // a database that has not had 20260814_signature_methods.sql applied must
  // not thereby refuse every handoff.
  const allowed = template.signatureMethods ?? null;
  if (allowed !== null && !allowed.includes('phone')) {
    return { ok: false, error: MARK_MINT_REFUSAL_PHONE_NOT_ALLOWED };
  }

  const made = await deps.createHandoff(template.id);
  if (!made.ok) return { ok: false, error: MARK_MINT_REFUSAL_UNAVAILABLE };

  try {
    return {
      ok: true,
      handoffId: made.handoffId,
      svg: deps.encode(markHandoffQrUrl(deps.origin, made.rawToken)),
      expiresInSeconds: HANDOFF_TTL_MINUTES * 60,
    };
  } catch {
    // A misconfigured origin, or text the encoder cannot fit. There is
    // nothing scannable to show and the pad is on the same screen.
    return { ok: false, error: MARK_MINT_REFUSAL_UNAVAILABLE };
  }
}
