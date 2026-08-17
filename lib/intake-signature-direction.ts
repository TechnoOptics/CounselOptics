/**
 * Which way a signature runs on a request, as pure rules.
 *
 * The question a person answers when they file is "does this involve a
 * signature", and the only two answers worth acting on are opposites:
 * something of ours has to go out and be signed by somebody else, or somebody
 * else's document has arrived and wants our name on it. The second one changes
 * what the legal team is looking at: the counterparty wrote it, so the file
 * itself is the request.
 *
 * WHERE IT IS STORED, and why nothing was migrated. The answer rides in the
 * existing `firm_matter_intakes.intake_answers` jsonb under
 * `signature_direction`, which is where every other in-house field on this
 * form already lives. It is deliberately NOT a status: lib/intake-workflow.ts
 * lines 5 to 28 set out why the seven-value CHECK on `status` is left alone,
 * and ten importers plus two crons are the reason.
 *
 * WHY THE READ IS ONE FUNCTION. Every request filed before this existed has no
 * such key at all, and a jsonb column can hold anything a future writer puts
 * there. Both of those have to read as "not a signature question" on every
 * screen, and a check spelled out at each reader is a check that will
 * eventually disagree with itself. Nothing here touches the database or
 * React, so all of it is exercised by tests/intake-signature-direction.test.ts.
 */

export type SignatureDirection = 'outbound' | 'inbound';

/** The key on `intake_answers`. Named once so no caller spells it. */
export const SIGNATURE_DIRECTION_KEY = 'signature_direction';

/** The question, as the person filing reads it. */
export const SIGNATURE_DIRECTION_QUESTION = 'Does this involve a signature?';

/**
 * The three answers, in the order they are offered.
 *
 * The third carries the empty string rather than a third direction, because
 * "not a signature question" is the absence of a direction and is exactly what
 * an absent key already means. Giving it a value of its own would make a
 * request filed today and a request filed last year say different things about
 * the same fact.
 */
export const SIGNATURE_DIRECTION_CHOICES: ReadonlyArray<{
  value: SignatureDirection | '';
  label: string;
}> = [
  {
    value: 'outbound',
    label: 'We need someone outside the company to sign something.',
  },
  {
    value: 'inbound',
    label: 'Someone outside the company has sent us something and wants us to sign it.',
  },
  { value: '', label: 'Not a signature question.' },
];

/**
 * The direction on a record, or null.
 *
 * Null for an absent key, for an empty string, and for anything that is not
 * one of the two words, which together are every request filed before this
 * question existed. Nothing is inferred from the request type or from an
 * attachment: a guess here would put a claim on the record that nobody made.
 */
export function readSignatureDirection(raw: unknown): SignatureDirection | null {
  return raw === 'outbound' || raw === 'inbound' ? raw : null;
}

/** Whether the counterparty's own document is the thing being asked about. */
export function isInboundSignature(raw: unknown): boolean {
  return readSignatureDirection(raw) === 'inbound';
}

/**
 * What the chip on a ticket says, or null when there is nothing to say.
 *
 * A request that is not a signature question gets no chip at all rather than a
 * chip reading "none", because a queue where every row carries a badge is a
 * queue where the badge stops being read.
 */
export function signatureDirectionLabel(raw: unknown): string | null {
  const direction = readSignatureDirection(raw);
  if (direction === 'outbound') return 'For outside signature';
  if (direction === 'inbound') return 'Sent to us to sign';
  return null;
}

/** The attachment field's label once the document is theirs, not ours. */
export const INBOUND_ATTACHMENT_LABEL = 'Attach the document they sent';

/**
 * What sits under that field.
 *
 * It says the document is not to be tidied up on the way in. A person who
 * retypes a counterparty's clause into their own words has changed the
 * instrument the legal team is being asked to read.
 */
export const INBOUND_ATTACHMENT_HELP =
  'Attach it exactly as you received it. Your legal team reads it as it stands and will not change their wording.';
