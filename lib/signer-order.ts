/**
 * Whose turn it is on a signing request, and whether an invitation may
 * go out.
 *
 * Today every signer on a request is emailed at once, and every one of
 * them can sign the moment the link arrives. That is right for a
 * document two people sign in either order, and wrong for the one this
 * flow produces: the counterparty signs what the firm approved, and the
 * employee counter-signs what the counterparty actually agreed to. An
 * employee whose signature can land first is signing an instrument that
 * is not finished.
 *
 * So a signature row gains `signer_order`, and this module is the whole
 * rule over it. Pure, because the same answer is needed in four places
 * that cannot share anything else: the email loop in
 * createSigningRequestAction, the write in lib/signature-write.ts, the
 * page at /sign/[token], and the employee's own record in the portal. A
 * rule stated four times is four rules as soon as one of them is edited.
 *
 * NULL IS TODAY'S BEHAVIOUR, AND THAT IS THE POINT
 * ------------------------------------------------
 * `order: null` means "no order", which is what every existing row means
 * and what every row means on a database where 20260807_flow_join.sql
 * has not been applied yet. A signer with no order is always ready. So a
 * firm that has not migrated, and every request sent before this shipped,
 * behaves exactly as it did last week: everyone at once.
 *
 * ORDERING IS A WORKFLOW CONTROL, NOT AN AUTHORIZATION CONTROL
 * ------------------------------------------------------------
 * State this plainly so nobody leans on it for the wrong thing. Being
 * out of turn is refused by the write as well as hidden by the page, so
 * it is enforced and not merely suggested. But what stops somebody
 * OTHER than the employee from signing as the employee is not this
 * module: an external signer proves themselves with a one-time access
 * code, and an internal signer with a session that matches their address
 * (resolveInternalSignerGate in lib/signer-view.ts). Order decides when
 * a signer may act. Those two decide whether it is really them.
 */

/** One signer, as much of them as any rule here needs. */
export type SignerOrderRecord = {
  /** firm_signatures.signer_order. Null means "no order". */
  order: number | null;
  /** firm_signatures.signed_at. */
  signedAt: string | null;
};

export type SignerTurn =
  /** They may sign now. */
  | 'ready'
  /** Somebody ahead of them has not signed yet. */
  | 'waiting'
  /** They already signed. */
  | 'done';

/**
 * A null order sorts before every number, which is what "mixed null and
 * numbered orders resolve nulls first" means: a numbered signer waits
 * for the unnumbered ones as well as for the lower numbers. That falls
 * out of the null-is-always-ready rule rather than fighting it. If it
 * did not, a request that mixed the two could deadlock its numbered
 * signers behind people who were never going to be ordered at all.
 */
function isLower(candidate: SignerOrderRecord, than: number): boolean {
  if (candidate.order === null) return true;
  return candidate.order < than;
}

/**
 * Whose turn it is, for one signer.
 *
 * An index outside the list is 'waiting': it names nobody, and answering
 * 'ready' for a signer that does not exist would be a gate that opens on
 * a bad argument.
 *
 * A gap in the numbering does not deadlock. The rule is "every LOWER
 * order has signed", not "the previous number has signed", so orders 1
 * and 3 with no 2 behave as 1 and 2 would.
 */
export function resolveSignerTurn(
  signers: readonly SignerOrderRecord[],
  index: number,
): SignerTurn {
  const self = signers[index];
  if (!self) return 'waiting';
  if (self.signedAt) return 'done';
  if (self.order === null) return 'ready';
  for (let i = 0; i < signers.length; i += 1) {
    if (i === index) continue;
    const other = signers[i];
    if (!other) continue;
    if (isLower(other, self.order) && !other.signedAt) return 'waiting';
  }
  return 'ready';
}

/**
 * The next signer an invitation is due for, or null when there is none.
 *
 * "Next" is the first unsigned signer whose turn has come, in list
 * order. The list order is the order the signers were created in, which
 * for this flow is also the numbering, so the two agree; where they do
 * not, any ready signer is a correct answer to "who may be invited now"
 * and the first one is the stable choice.
 *
 * This answers who, and deliberately not whether. A signer who is ready
 * now may have been ready an hour ago and been emailed then, and mailing
 * them again because a colleague signed would be noise. The caller
 * settles that by asking this of the list as it was before the signature
 * landed as well: a signer who was 'waiting' then and is the next invite
 * now is the one who just became reachable. See lib/signature-write.ts.
 */
export function nextInviteIndex(signers: readonly SignerOrderRecord[]): number | null {
  for (let i = 0; i < signers.length; i += 1) {
    if (resolveSignerTurn(signers, i) === 'ready') return i;
  }
  return null;
}

/**
 * The sentence a signer whose turn has not come reads, wherever they
 * meet the refusal: on the page, or from the write if they posted to it
 * directly.
 *
 * Calm, and it does not say the link is broken, because it is not. It
 * says what has to happen first and that they will be told. Nothing here
 * names the other signer: this string is reachable by anyone holding the
 * link, and who else is on an agreement is not something a page should
 * volunteer to a caller who has not proved they are the signer.
 */
export const SIGNER_NOT_YET_YOUR_TURN =
  'This document is waiting on another signature before yours. ' +
  'We will email you as soon as it is your turn.';
