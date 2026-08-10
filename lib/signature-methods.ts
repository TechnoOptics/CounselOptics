/**
 * Which ways of signing a firm will accept, and the one decision that
 * enforces the answer.
 *
 * No imports, no database, no 'server-only'. The picker the firm sets this
 * with runs in a browser, the gate that enforces it runs on a server, and the
 * two must not be able to disagree about what 'upload' means or about whether
 * an empty selection is a restriction or the absence of one. So the rules live
 * in one dependency-free file that both sides read.
 *
 * NULL IS NOT EMPTY, and most of this file exists to keep them apart.
 *
 *   null  - no restriction was recorded. Every row that exists means this,
 *           and it is what the product did before the column existed: all
 *           four methods are offered.
 *   [...] - exactly these methods, and nothing else.
 *   []    - a restriction that names no method. The database CHECK forbids
 *           storing one, but this module can still be handed one by a caller
 *           or by a column an older build wrote, and it reads it as "refuse
 *           everything" rather than quietly widening it back to null. A
 *           document nobody can sign is a visible problem the firm can fix;
 *           a restriction silently lifted is not visible at all.
 *
 * THE PHONE IS A METHOD HERE, not a channel. The QR handoff produces a drawn
 * mark on the phone's pad, so 'phone' and 'draw' could have been modelled as
 * two independent axes. They are not, because the firm was asked to choose
 * between four ways of signing and that is the question this column answers:
 * a signature that arrives from a handed-off phone is recorded and enforced as
 * 'phone', whatever the phone drew with. The consequence, stated rather than
 * discovered: a firm that forbids 'draw' but allows 'phone' still receives a
 * drawn mark, and the picker says so beside the option rather than leaving the
 * firm to find out from an executed instrument.
 */

/** The four ways a person may make their mark, in the order they are shown. */
export const SIGNATURE_METHODS = ['draw', 'type', 'phone', 'upload'] as const;

export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

/** The words the firm and the signer both read. Kept beside the values so a
 *  refusal sentence and a picker label cannot describe the same method
 *  differently. */
export const SIGNATURE_METHOD_LABELS: Record<SignatureMethod, string> = {
  draw: 'Draw',
  type: 'Type a name',
  phone: 'Sign on your phone',
  upload: 'Upload an image',
};

/** One line of plain explanation each, for the picker. */
export const SIGNATURE_METHOD_DESCRIPTIONS: Record<SignatureMethod, string> = {
  draw: 'The signer draws their signature with a mouse, trackpad or finger.',
  type: 'The signer types their name and it is rendered in a script face. A typed name adopted with intent to sign is a valid electronic signature.',
  phone:
    'The signer scans a code and finishes on their phone. The mark made there is a drawn one, so allowing this allows a drawn signature on this template.',
  upload:
    'The signer attaches an image of a signature they already have. This is the weakest of the four for attribution: nothing establishes who was holding the device when the image was made.',
};

/** Shown when a firm tries to save a template that nobody could then sign. */
export const NO_METHOD_ENABLED_ERROR =
  'Leave at least one signature method enabled, or nobody can sign this template.';

/**
 * What a signer is told when they used a method the firm did not allow.
 *
 * Plain, and not an accusation. The ordinary way to reach it is a stale page
 * held open across a change to the template, not an attack, and somebody part
 * way through signing a legal document is not the person to be terse with.
 */
export function methodRefusalSentence(method: SignatureMethod | null): string {
  const label = method ? SIGNATURE_METHOD_LABELS[method] : null;
  return label
    ? `"${label}" is not one of the signature methods allowed on this document. Please use one of the methods shown, or ask the firm.`
    : 'This signature could not be accepted because the way it was made was not recorded. Please reload the page and sign again.';
}

/** One method from an untrusted value, or null. Exact match only: no casing
 *  fixes and no aliases, because a value this file guesses at is a value the
 *  firm did not choose. */
export function parseSignatureMethod(value: unknown): SignatureMethod | null {
  return typeof value === 'string' &&
    (SIGNATURE_METHODS as readonly string[]).includes(value)
    ? (value as SignatureMethod)
    : null;
}

/**
 * Read a stored signature_methods column.
 *
 * Anything that is not an array reads as unrestricted, because that is what a
 * missing column, a null and a database that has not run the migration all
 * look like from here, and all three mean the same thing.
 *
 * An array is a restriction, and stays one even if nothing in it survives
 * the filter. See the module header for why that asymmetry is deliberate.
 */
export function parseAllowedSignatureMethods(
  value: unknown,
): SignatureMethod[] | null {
  if (!Array.isArray(value)) return null;
  const kept = new Set<SignatureMethod>();
  for (const entry of value) {
    const method = parseSignatureMethod(entry);
    if (method) kept.add(method);
  }
  // Canonical order, so a stored list and a freshly chosen one compare equal
  // and a row rewritten by a save does not look like a change that was made.
  return SIGNATURE_METHODS.filter((m) => kept.has(m));
}

export type SignatureMethodDecision =
  | { ok: true; method: SignatureMethod | null }
  | { ok: false; error: string };

/**
 * The gate. Given what the request allows and what the caller says they did,
 * decide whether to record the signature.
 *
 * The unrestricted case tolerates a missing claim, and it has to: every
 * signing link already in the wild belongs to a page that predates the field,
 * and refusing those would break signing for everyone the day this ships in
 * exchange for protecting a restriction that does not exist. The method comes
 * back as null and the audit event says unspecified rather than guessing at
 * one.
 *
 * The restricted case does NOT tolerate a missing claim. Once a firm has
 * forbidden something, silence must not be the way past it, or the whole
 * control is one deleted JSON key wide. Nothing is broken by that strictness:
 * the column only becomes non-null when a firm opts a template in through the
 * picker, which ships with the page that sends the field.
 */
export function decideSignatureMethod(input: {
  /** The parsed column. Null means no restriction was recorded. */
  allowed: SignatureMethod[] | null;
  /** Whatever the caller claimed. Untrusted. */
  claimed: unknown;
}): SignatureMethodDecision {
  const method = parseSignatureMethod(input.claimed);
  if (input.allowed === null) return { ok: true, method };
  if (!method || !input.allowed.includes(method)) {
    return { ok: false, error: methodRefusalSentence(method) };
  }
  return { ok: true, method };
}

export type SignatureMethodSelection =
  | { ok: true; methods: SignatureMethod[] | null | undefined }
  | { ok: false; error: string };

/**
 * Validate a firm's chosen selection on its way to the column.
 *
 * Three inputs mean three different writes and they are kept apart rather
 * than collapsed into a falsy check, the same way lib/firm-templates.ts
 * already keeps them apart for document_layout:
 *
 *   undefined - the caller is not touching this setting. Nothing is written.
 *   null      - go back to allowing all four. Null is written.
 *   [...]     - this selection. Written, unless it is empty.
 *
 * All four selected is normalised to null, not stored as a four-element
 * array. They are the same restriction, and storing one of them two ways
 * means every reader has to know that. It also means a fifth method added
 * later widens the templates that never restricted anything, which is the
 * right answer, and leaves alone the ones that did.
 */
export function normalizeSignatureMethodSelection(
  value: unknown,
): SignatureMethodSelection {
  if (value === undefined) return { ok: true, methods: undefined };
  if (value === null) return { ok: true, methods: null };
  const methods = parseAllowedSignatureMethods(value);
  // A non-array selection is not a selection. It is refused rather than read
  // as "leave it alone", because a caller that sent something meant to change
  // it and must not be told it succeeded.
  if (methods === null || methods.length === 0) {
    return { ok: false, error: NO_METHOD_ENABLED_ERROR };
  }
  if (methods.length === SIGNATURE_METHODS.length) return { ok: true, methods: null };
  return { ok: true, methods };
}

/**
 * The method behind a mode the signature pad reports.
 *
 * components/SignaturePad reports 'drawn' | 'typed' | 'uploaded', which are
 * the values firm_template_submissions.signature_mode has stored since
 * 20260806_template_signature_capture.sql. Those names are not changed here:
 * the column has a CHECK constraint naming them and rows already carry them.
 * This is the translation, in one place, and it deliberately has no default.
 * A mode this function does not know produces null, which a restricted
 * request then refuses.
 */
export function signatureMethodFromPadMode(mode: unknown): SignatureMethod | null {
  if (mode === 'drawn') return 'draw';
  if (mode === 'typed') return 'type';
  if (mode === 'uploaded') return 'upload';
  return null;
}

/**
 * What a surface holding a pad may claim it was handed, in one function.
 *
 * `padMode` is the pad's own vocabulary and is untrusted, so a caller that
 * sends the string 'phone' there is translated to null by
 * signatureMethodFromPadMode and has therefore said nothing. That is not an
 * oversight to be tidied up: 'phone' is the only one of the four a server can
 * establish for itself, and it is established by a handoff that burned a
 * one-time token and bound a cookie to the scanning device, never by a browser
 * asserting it. `attestedPhone` is that establishment and nothing else may set
 * it.
 *
 * lib/signature-write.ts states the same rule for the outside signer, over a
 * different vocabulary: it is handed a SignatureMethod claim rather than a pad
 * mode, and its own `source === 'mobile_handoff'` is the attestation. The two
 * agree on the only part that matters, which is that a browser saying 'phone'
 * is treated as having said nothing.
 */
export function claimedSignatureMethod(input: {
  /** True only when the SERVER established the mark came from a bound phone. */
  attestedPhone: boolean;
  /** Whatever the pad reported. Untrusted. */
  padMode: unknown;
}): SignatureMethod | null {
  return input.attestedPhone
    ? 'phone'
    : signatureMethodFromPadMode(input.padMode);
}

/** The three modes components/SignaturePad can render, in its tab order. */
export const PAD_MODES = ['drawn', 'typed', 'uploaded'] as const;
export type PadMode = (typeof PAD_MODES)[number];

/**
 * Which pad tabs to offer for a given restriction.
 *
 * The inverse of signatureMethodFromPadMode, and the only place the two
 * vocabularies meet on this side. 'phone' is dropped rather than mapped,
 * because it is not something the desktop pad can do: a template that allows
 * only the phone leaves this empty on purpose, and the signer uses the QR card
 * instead. Restoring a tab there would offer a method the firm forbade and
 * the server would refuse.
 */
export function padModesFor(allowed: SignatureMethod[] | null): PadMode[] {
  if (allowed === null) return [...PAD_MODES];
  return PAD_MODES.filter((mode) => {
    const method = signatureMethodFromPadMode(mode);
    return method !== null && allowed.includes(method);
  });
}
