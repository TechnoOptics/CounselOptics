/**
 * What a template field accepts, and what it says when it does not.
 *
 * No imports, no database, no 'server-only', for the same reason
 * lib/signature-methods.ts has none: the editor that sets a format runs in a
 * browser, the form that answers it runs in a browser, and the gates that
 * decide whether an answer may be written run on a server. All four read the
 * rules here, so none of them can disagree about what an email is.
 *
 * THE UNION IS THE WHITELIST
 * --------------------------
 * Before this module, reading a stored field's type was written out twice as a
 * literal:
 *
 *   type: o.type === 'date' || o.type === 'textarea' ? o.type : 'text'
 *
 * once in lib/firm-templates.ts (the write side) and once in
 * lib/counterparty-fields.ts (the read side). Anything not on that list
 * coerces to 'text' SILENTLY, so a format added to the type union without
 * widening both literals is a format a firm can pick, save, and never see
 * again: the field comes back as a plain text box and nothing anywhere says
 * why. parseTemplateFieldType below is derived from TEMPLATE_FIELD_TYPES, both
 * call sites use it, and tests/template-field-formats.test.ts round-trips
 * every member of the union rather than a list written out again in the test.
 *
 * A FORMAT IS NOT THE REQUIRED FLAG. Every check here accepts an empty answer.
 * Whether a blank may be left blank is the `required` flag's question, asked by
 * missingRequired (lib/template-submissions.ts) and missingCounterpartyFields
 * (lib/counterparty-fields.ts). A format that also refused blanks would put two
 * sentences under one input for one mistake.
 *
 * THERE IS NO SIGNATURE FORMAT, on purpose. See NO_SIGNATURE_FORMAT below.
 *
 * WHAT IS STORED IS THE NORMALISED VALUE. A phone number typed as
 * "555.123.4567" is stored and printed as "(555) 123-4567", so the instrument
 * carries one shape whoever typed it. The normalisation only ever removes
 * punctuation and adds the punctuation the US form uses; it never changes a
 * digit, and an amount with more precision than two decimal places is REFUSED
 * rather than rounded, because rounding an amount on a legal instrument
 * without saying so is a change to the obligation.
 */

/**
 * The formats a field may have, in the order the editor offers them: the three
 * a template could always have first, so an author's existing choices stay
 * where they were, then the four that were added.
 */
export const TEMPLATE_FIELD_TYPES = [
  'text',
  'textarea',
  'date',
  'email',
  'number',
  'currency',
  'phone',
] as const;

export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

/**
 * WHY 'signature' IS NOT IN THAT LIST.
 *
 * A signature already has three mechanisms in this repo and none of them is a
 * field:
 *
 *   - lib/template-blank-detection.ts finds the places a document is signed
 *     and deliberately gives them no key, so a signature place can never
 *     become a field. Its own comment says why: "a {{signature}} field would
 *     be a text input somebody types a signature into", which is the defect
 *     lib/template-proposal.ts strips out of every imported body.
 *   - lib/signature-methods.ts decides HOW a mark may be made on a template.
 *     That is the Signature section of the editor, not the Fields section.
 *   - components/SignaturePad.tsx captures the mark, and
 *     lib/signature-geometry.ts is the single module that decides where on the
 *     page it is drawn.
 *
 * mergeTemplateDocument appends the execution block itself, so a field typed
 * "signature" would put a second signature line on an instrument that already
 * has one. The right answer to "I want a signature here" is the Signature
 * section, and the Fields section says so rather than offering a fourth idea
 * of what a signature is.
 */
export const NO_SIGNATURE_FORMAT =
  'A signature is not a field format. The signature block is added to this ' +
  'document for you, and the Signature section decides how it may be signed.';

/** What the author picks from, and what a filled form calls the field. */
export const TEMPLATE_FIELD_TYPE_LABELS: Record<TemplateFieldType, string> = {
  text: 'Short text',
  textarea: 'Paragraph',
  date: 'Date',
  email: 'Email address',
  number: 'Number',
  currency: 'Amount in dollars',
  phone: 'Phone number',
};

/**
 * Read a stored or posted type. The ONE whitelist: both sides of the jsonb
 * boundary call this, so a type stored by one reading and read back by another
 * cannot be a different field.
 *
 * Anything unrecognised is 'text', which is the fail-safe direction and is
 * what every field saved before formats existed says by saying nothing.
 */
export function parseTemplateFieldType(raw: unknown): TemplateFieldType {
  return (TEMPLATE_FIELD_TYPES as readonly unknown[]).includes(raw)
    ? (raw as TemplateFieldType)
    : 'text';
}

/**
 * How the browser should present this format.
 *
 * Deliberately NOT `type="email"`, `type="number"` or `type="tel"` with the
 * browser's own validation attached. `type="number"` silently drops what it
 * cannot parse, which is the one behaviour the brief rules out: an answer must
 * be told what is wrong with it, not cleared. `inputMode` still brings up the
 * right keyboard on a phone, which is the part that helps.
 */
export function templateFieldInputAttributes(type: TemplateFieldType): {
  type: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email';
  autoComplete?: string;
} {
  switch (type) {
    case 'date':
      return { type: 'date' };
    case 'email':
      return { type: 'text', inputMode: 'email', autoComplete: 'email' };
    case 'phone':
      return { type: 'text', inputMode: 'tel', autoComplete: 'tel' };
    case 'number':
    case 'currency':
      return { type: 'text', inputMode: 'decimal' };
    default:
      return { type: 'text' };
  }
}

export type FieldValueCheck =
  /** Accepted. `value` is what should be stored and printed, which is not
   *  always what was typed: punctuation is normalised. */
  | { ok: true; value: string }
  /** Refused, with a sentence saying what to fix. */
  | { ok: false; message: string };

/**
 * The months, so a date can be checked against the calendar rather than
 * against a regex that accepts the 30th of February.
 */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 1234567.5 as "1,234,567.50". Written out rather than taken from Intl so
 *  this module keeps no imports and no locale to resolve, and so the server
 *  and the browser produce the same characters. */
function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * WHAT THE EMAIL CHECK LETS THROUGH, stated rather than left to be discovered.
 *
 * It asks for one @, something before it, and a dotted domain after it whose
 * labels are all non-empty and whose last label is at least two characters. It
 * does NOT check that the domain exists, that the local part obeys RFC 5322
 * quoting, or that the address can receive mail.
 *
 * The line is drawn there on purpose. A strict RFC-shaped regex refuses real
 * addresses, and the cost of a false refusal here is an employee who cannot
 * file their form and has nobody to appeal to. The cost of a false accept is
 * one bounced email. So this catches the mistake somebody actually makes
 * (typing a name, or leaving the domain off) and lets everything arguable
 * through.
 */
function checkEmail(value: string): FieldValueCheck {
  const wrong = {
    ok: false as const,
    message:
      'This needs to look like an email address, with an @ and a dot after ' +
      'it, for example dana@company.com.',
  };
  if (/\s/.test(value)) return wrong;
  const at = value.split('@');
  if (at.length !== 2) return wrong;
  const [local, domain] = at;
  if (!local || !domain) return wrong;
  const labels = domain.split('.');
  if (labels.length < 2) return wrong;
  if (labels.some((l) => l.length === 0)) return wrong;
  if (labels[labels.length - 1].length < 2) return wrong;
  return { ok: true, value };
}

function checkNumber(value: string): FieldValueCheck {
  const cleaned = value.replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return {
      ok: false,
      message: 'This takes a number, for example 12 or 3.5.',
    };
  }
  return { ok: true, value: cleaned };
}

function checkCurrency(value: string): FieldValueCheck {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return {
      ok: false,
      message: 'This takes an amount in dollars, for example 1,500 or 1500.00.',
    };
  }
  const [whole, fraction = ''] = cleaned.replace(/^-/, '').split('.');
  if (fraction.length > 2) {
    return {
      ok: false,
      message:
        'Amounts take at most two decimal places. Write the cents you mean, ' +
        'for example 1,500.25.',
    };
  }
  const sign = cleaned.startsWith('-') ? '-' : '';
  const cents = (fraction + '00').slice(0, 2);
  return { ok: true, value: `${sign}$${groupThousands(whole)}.${cents}` };
}

/**
 * US phone numbers, because this product is pinned to US formats (lib/format.ts).
 *
 * Accepts the punctuation people actually type: spaces, dashes, dots,
 * parentheses, and a leading +1 or 1. Nothing is refused for its punctuation.
 * What IS refused is a number that is not ten digits, because a nine-digit
 * number on a document is a number nobody can call.
 *
 * The E.164 form Twilio needs is produced where Twilio is called and is not
 * this. This is the printed form, on a page a person reads.
 */
function checkPhone(value: string): FieldValueCheck {
  const wrong = {
    ok: false as const,
    message:
      'This takes a US phone number with ten digits, for example ' +
      '(555) 123-4567.',
  };
  // The allowlist matters: without it "555CALL1234567" reduces to ten digits
  // and would be accepted with letters still in it.
  if (!/^\+?[\d\s().-]+$/.test(value)) return wrong;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11) {
    if (!digits.startsWith('1')) return wrong;
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return wrong;
  return {
    ok: true,
    value: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
  };
}

function checkDate(value: string): FieldValueCheck {
  const wrong = {
    ok: false as const,
    // Says the shape rather than guessing at what was meant. "08/10/2026" is
    // August 10th here and October 8th in most of the world, and a checker
    // that picked one would be putting a date on an instrument that nobody
    // asserted.
    message: 'Pick a date from the calendar, or write it as 2026-08-10.',
  };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return wrong;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return wrong;
  if (day < 1 || day > daysInMonth(year, month)) return wrong;
  return { ok: true, value };
}

/**
 * Whether this answer fits this format, and what should be stored if it does.
 *
 * Pure and total: any input, including one that is not a string, produces an
 * answer. It is called from a browser to tell somebody what to fix, and from
 * the server to decide whether the answer may be written at all. The server
 * call is the gate; the browser call is a courtesy, because every 'use server'
 * export is a public HTTP endpoint and a pattern in a page is a hint.
 */
export function checkTemplateFieldValue(
  type: TemplateFieldType,
  raw: unknown,
): FieldValueCheck {
  const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
  if (!value) return { ok: true, value: '' };
  switch (type) {
    case 'email':
      return checkEmail(value);
    case 'number':
      return checkNumber(value);
    case 'currency':
      return checkCurrency(value);
    case 'phone':
      return checkPhone(value);
    case 'date':
      return checkDate(value);
    default:
      return { ok: true, value };
  }
}

/** The minimum a caller has to know about a field to check an answer for it. */
export type FormattedField = {
  key: string;
  label: string;
  type: TemplateFieldType;
};

/**
 * Every answer that does not fit its field, in the template's own order, so a
 * page reports them in the order they appear on the document.
 *
 * A key the template never declared is ignored rather than reported: a caller
 * cannot make this list say anything by posting extra keys, and the values
 * under those keys are dropped by sanitizeTemplateValues and
 * sanitizeCounterpartyValues before anything reads them.
 */
export function invalidFieldValues(
  fields: readonly FormattedField[],
  values: Record<string, unknown> | undefined | null,
): { key: string; label: string; message: string }[] {
  const given = values && typeof values === 'object' ? values : {};
  const out: { key: string; label: string; message: string }[] = [];
  for (const field of fields) {
    const result = checkTemplateFieldValue(field.type, given[field.key]);
    if (!result.ok) out.push({ key: field.key, label: field.label, message: result.message });
  }
  return out;
}

/**
 * The one sentence a server hands back when an answer does not fit its field,
 * or null when they all do.
 *
 * Each refusal is named by the field's own LABEL, because the employee reads
 * labels and has never seen a key, and each carries the same sentence the page
 * would have shown, so a refusal that arrives from the server and one that
 * arrives from the browser say the same thing.
 */
export function fieldFormatRefusal(
  fields: readonly FormattedField[],
  values: Record<string, unknown> | undefined | null,
): string | null {
  const bad = invalidFieldValues(fields, values);
  if (bad.length === 0) return null;
  return bad.map((b) => `${b.label}: ${b.message}`).join(' ');
}
