import type { TemplateField } from './firm-templates';
import { fieldBoxKeys, type FieldBox } from './template-field-boxes';

/**
 * What the other side of an agreement is allowed to write into it, and what
 * their answers look like once they have.
 *
 * EVERYTHING HERE ARRIVES FROM A CALLER WE DO NOT CONTROL. The signing
 * surface is public: the token in the URL is the only credential on it, and
 * the action that stores these values is a `'use server'` export, which is a
 * public HTTP endpoint callable with any arguments in any order. So the rules
 * are not "what the form rendered", they are checked again here, over plain
 * values, with tests. Nothing below trusts a key, a length or a type because
 * a form produced it.
 *
 * THE PARTY RULE IS THE ONE THAT MATTERS
 * --------------------------------------
 * A counterparty must not be able to write a field the employee owns. The
 * employee's answers are what counsel reviewed and approved, and a
 * counterparty who could overwrite one could change the approved instrument
 * after approval. So sanitizeCounterpartyValues DROPS any key whose field is
 * not `party: 'counterparty'`, rather than rejecting the whole submission:
 * dropping is the behaviour that stays correct when a template is edited
 * between render and signature, and refusing the submission would let a
 * template edit strand a signer.
 *
 * The second gate is the recorded geometry. A value can only be accepted for
 * a key the renderer actually drew a blank for, because a value with nowhere
 * to go on the page would be recorded as a fact the instrument does not
 * carry. lib/template-field-boxes.ts is where that set comes from.
 *
 * DATES
 * -----
 * The counterparty PICKS a date; nothing is auto-filled. A date the signer
 * did not choose is a fact about their agreement that they did not assert,
 * and pre-filling one is how "today" ends up on an instrument that is dated
 * from an earlier meeting. What is stored is the ISO yyyy-mm-dd the picker
 * produced, and what is DRAWN is the long form, "August 6, 2026", which is
 * the same format the signature block already uses on the same page
 * (formatSignedOn in lib/firm-template-placeholders.ts). One instrument, one
 * date format, and no reader has to guess whether 06/08 is June or August.
 *
 * The conversion is deliberately not Date-based. `new Date('2026-08-06')`
 * parses as UTC midnight, and toLocaleDateString then renders it in the
 * reader's own zone, so a signer west of Greenwich would see the day before
 * the one they picked. The parts are read from the string instead, which has
 * no zone in it to get wrong, and the overlay and the stamp both call this
 * one function so the preview and the executed copy cannot show two dates.
 */

/** Longest value accepted for one blank. The blank is one line on the page,
 *  and a value past this cannot be drawn legibly however far it is shrunk. */
export const COUNTERPARTY_VALUE_MAX = 200;

/**
 * The characters WinAnsi can encode, which is the whole of what pdf-lib's
 * standard fonts can draw.
 *
 * This is checked here, where the signer can do something about it, and not
 * at the stamp, where it is a thrown error hours later in the middle of
 * producing the executed copy. lib/template-release.ts already names an
 * unencodable character as one of the ways a render dies; this is that hazard
 * arriving from a stranger's keyboard rather than a colleague's.
 *
 * The band above 0x9F is Latin-1 and covers the accented letters of every
 * western European language, so this is not a rule against non-English names.
 * The explicit list is the WinAnsi block between 0x80 and 0x9F, which carries
 * the curly quotes, the dashes and the ellipsis that a phone keyboard
 * substitutes without being asked.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * The characters in `value` the standard fonts cannot draw, distinct, in the
 * order they first appear.
 *
 * isWinAnsiEncodable answers whether a string is safe, which is what a GATE
 * needs. This answers which parts of it are not, which is what a person needs:
 * a firm typing its own name into the letterhead designer is told exactly
 * which characters will not reach the page, at the moment they type them,
 * rather than finding out from a document a recipient is holding.
 *
 * Iterated by code point, so an emoji or any other astral character is one
 * entry someone can recognise instead of two halves of a surrogate pair.
 */
export function unencodableCharacters(value: string): string[] {
  const out: string[] = [];
  for (const ch of String(value ?? '')) {
    if (isWinAnsiEncodable(ch) || out.includes(ch)) continue;
    out.push(ch);
  }
  return out;
}

export function isWinAnsiEncodable(value: string): boolean {
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) continue;
    if (code >= 0xa0 && code <= 0xff) continue;
    if (WINANSI_EXTRAS.has(code)) continue;
    return false;
  }
  return true;
}

export type CounterpartyValues = Record<string, string>;

/** True for a field the other side fills in. Absent party means employee. */
export function isCounterpartyField(field: {
  party?: string | null;
}): boolean {
  return field.party === 'counterparty';
}

/**
 * The fields the employee is asked for: everything that is not the other
 * side's.
 *
 * Every surface that shows the employee a form, checks their required
 * answers, or stores what they typed calls this, so a field the legal team
 * assigned to the counterparty cannot be asked of the employee on one page
 * and skipped on another.
 */
export function employeeFieldsOf<T extends { party?: string | null }>(
  fields: readonly T[],
): T[] {
  return fields.filter((f) => !isCounterpartyField(f));
}

/**
 * Read a stored `party` back.
 *
 * One rule, called by the write side (sanitizeFields in lib/firm-templates.ts,
 * which stores it) and by the read side (parseTemplateFields below, which
 * reads it back out of the same jsonb). Anything unrecognised is the
 * employee, the same fail-safe direction sanitizeFields already uses for an
 * unknown field type. Two coercions that "obviously agree" is how a field
 * ends up owned by one party on the way in and the other on the way out.
 */
export function parseTemplateFieldParty(raw: unknown): 'employee' | 'counterparty' {
  return raw === 'counterparty' ? 'counterparty' : 'employee';
}

/**
 * Read a template's declared fields back across the jsonb boundary.
 *
 * The mirror of sanitizeFields, which is the write side and cannot be shared
 * because lib/firm-templates.ts is a `'use server'` module whose every export
 * is a public HTTP endpoint. Malformed entries are dropped rather than
 * repaired, for the same reason parseFieldBoxes drops them: a field nobody
 * can describe is a question nobody should be asked.
 */
export function parseTemplateFields(raw: unknown): TemplateField[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateField[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, 40)) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key : '';
    if (!/^[a-z0-9_]{1,40}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: (typeof o.label === 'string' ? o.label : key).slice(0, 80),
      type: o.type === 'date' || o.type === 'textarea' ? o.type : 'text',
      required: o.required === true,
      party: parseTemplateFieldParty(o.party),
    });
  }
  return out;
}

/**
 * The fields this document actually asks the counterparty for.
 *
 * Both conditions are required and neither is redundant. The party flag says
 * whose field it is, which only the legal team sets. The recorded boxes say
 * whether the approved document has a blank for it, which only the renderer
 * knows: a field added to the template after this document was rendered has
 * no blank on it, and asking the signer for it would collect a value with
 * nowhere to go.
 */
export function counterpartyFieldsOnDocument(
  fields: readonly TemplateField[],
  boxes: readonly FieldBox[],
): TemplateField[] {
  const drawn = new Set(fieldBoxKeys(boxes as FieldBox[]));
  return fields.filter((f) => isCounterpartyField(f) && drawn.has(f.key));
}

/**
 * Keep only what the counterparty may write, normalised.
 *
 * Mirrors sanitizeTemplateValues (lib/template-fill.ts), which does the same
 * job for the employee, with one difference that is the whole point: the
 * filter is `party === 'counterparty'` rather than "declared on the
 * template". An employee-owned key submitted here is dropped.
 *
 * Whitespace is folded to single spaces because the blank is one line on the
 * page. A newline inside a value would be drawn as nothing by pdf-lib and
 * silently shorten the value on the instrument, which is worse than a value
 * that is visibly one line.
 */
export function sanitizeCounterpartyValues(
  fields: readonly TemplateField[],
  values: unknown,
): CounterpartyValues {
  const raw = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  const out: CounterpartyValues = {};
  for (const f of fields) {
    if (!isCounterpartyField(f)) continue;
    const value = raw[f.key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const cleaned = String(value)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, COUNTERPARTY_VALUE_MAX);
    if (cleaned) out[f.key] = cleaned;
  }
  return out;
}

/**
 * Which required blanks are still empty.
 *
 * Returns keys rather than a boolean so the page can say which ones, and
 * returns them in the template's own order so it says them in the order they
 * appear on the document.
 */
export function missingCounterpartyFields(
  fields: readonly TemplateField[],
  values: CounterpartyValues,
): string[] {
  return fields
    .filter((f) => isCounterpartyField(f) && f.required && !values[f.key])
    .map((f) => f.key);
}

/**
 * The exact bytes the recorded hash is taken over.
 *
 * Key-sorted and JSON-encoded, so the same answers hash the same however the
 * browser happened to order them and whatever the column's jsonb ordering
 * does to them in storage. A hash nobody can reproduce is not evidence.
 */
export function canonicalizeForHash(values: CounterpartyValues): string {
  const keys = Object.keys(values).sort();
  return JSON.stringify(keys.map((k) => [k, values[k]]));
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * An ISO yyyy-mm-dd as the document prints it. Anything else is returned
 * unchanged, because a value we cannot parse is still the signer's answer and
 * dropping it would be worse than printing it as they typed it.
 */
export function formatCounterpartyDate(raw: string): string {
  const value = String(raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return value;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/**
 * What is drawn into a blank, as opposed to what is stored in it.
 *
 * THE OVERLAY AND THE STAMP BOTH CALL THIS. It is the value half of the
 * preview-equals-delivered invariant: resolveFieldBoxRect settles where, and
 * this settles what, and if either end had its own copy the signer would
 * confirm one thing and receive another.
 */
export function formatCounterpartyValue(
  field: { type?: string | null },
  value: string,
): string {
  if (field.type === 'date') return formatCounterpartyDate(value);
  return String(value ?? '').trim();
}

// ---------------------------------------------------------------------
// The server-side decision
// ---------------------------------------------------------------------

export type CounterpartySubmissionRefusal =
  /** The document has been signed. Its contents are settled. */
  | 'already-signed'
  /** The firm recalled the request. */
  | 'canceled'
  /** This signer declined or asked for changes, or the request is on hold. */
  | 'on-hold'
  /** An external signer who has not entered the code from their email. */
  | 'code-required'
  /** This document asks the signer for nothing. */
  | 'nothing-to-fill'
  /** A required blank is empty. */
  | 'incomplete'
  /** A value uses characters the document's font cannot draw. */
  | 'unsupported-characters';

export type CounterpartySubmissionDecision =
  | { ok: true; values: CounterpartyValues; canonical: string }
  | { ok: false; reason: CounterpartySubmissionRefusal; missing?: string[] };

/**
 * Whether these values may be written onto this signature row.
 *
 * Pure, and every refusal is exercised by a test, because this is the whole
 * of the authorization on a public endpoint and a gate with nothing
 * exercising it is a gate nobody knows is open.
 *
 * The order mirrors resolveSignerDocumentAccess deliberately: the access code
 * first, so a link forwarded without its code learns nothing about the
 * request behind it, then recall, then the signer's own response. Do not
 * reorder these.
 */
export function resolveCounterpartySubmission(input: {
  accessCodeRequired: boolean;
  accessVerifiedAt: string | null;
  requestStatus: string;
  signedAt: string | null;
  signerResponse: string | null;
  /** The counterparty fields this document actually carries blanks for. */
  fields: readonly TemplateField[];
  /** Whatever the caller sent. */
  values: unknown;
}): CounterpartySubmissionDecision {
  if (input.accessCodeRequired && !input.accessVerifiedAt) {
    return { ok: false, reason: 'code-required' };
  }
  if (input.requestStatus === 'canceled') return { ok: false, reason: 'canceled' };
  if (input.signedAt) return { ok: false, reason: 'already-signed' };
  if (
    input.signerResponse ||
    input.requestStatus === 'rejected' ||
    input.requestStatus === 'changes_requested'
  ) {
    return { ok: false, reason: 'on-hold' };
  }
  const fields = input.fields.filter(isCounterpartyField);
  if (fields.length === 0) return { ok: false, reason: 'nothing-to-fill' };

  const values = sanitizeCounterpartyValues(fields, input.values);
  const missing = missingCounterpartyFields(fields, values);
  if (missing.length > 0) return { ok: false, reason: 'incomplete', missing };
  // Refused here rather than at the stamp. A value the document's font cannot
  // draw is a thrown error in the middle of producing the executed copy, hours
  // after the only person who could have retyped it has gone.
  const unsupported = Object.keys(values).filter((k) => !isWinAnsiEncodable(values[k]));
  if (unsupported.length > 0) {
    return { ok: false, reason: 'unsupported-characters', missing: unsupported };
  }
  return { ok: true, values, canonical: canonicalizeForHash(values) };
}

/** Calm, plain wording for each refusal, kept beside the decision so the page
 *  and the action cannot describe the same refusal differently. */
export const COUNTERPARTY_REFUSAL_COPY: Record<CounterpartySubmissionRefusal, string> = {
  'already-signed':
    'This document has been signed, so its details can no longer be changed.',
  canceled:
    'This signing request was recalled, so the document is no longer available here.',
  'on-hold':
    'This document is on hold. The firm will send a new link if a revised version is ready.',
  'code-required':
    'Enter the access code from your email to reach this document.',
  'nothing-to-fill': 'This document does not ask you for any details.',
  incomplete: 'Please fill in the details marked as required before you continue.',
  // Says what to do, and does not blame the signer for their own alphabet.
  'unsupported-characters':
    'One of your answers uses characters this document cannot print. Please ' +
    'write it in the Latin alphabet, or ask the firm to send a version that ' +
    'can carry it.',
};
