/**
 * The letterhead a firm DESIGNS, as opposed to the one it uploads.
 *
 * A firm can already upload a wide image strip, which lands on
 * firms.letterhead_url and gets painted across the top of a rendered PDF. Not
 * every legal team has that image, and the ones that do often have it only as
 * a Word or PDF original nobody can export cleanly. So this is the second
 * route: the same information, typed in, stored structured, and drawn as real
 * vector text. It stays crisp at any zoom and needs no asset at all.
 *
 * WHERE IT IS STORED, AND WHY THERE IS NO MIGRATION
 * -------------------------------------------------
 * Under `firms.metadata.letterhead_design`. firms.metadata is an existing
 * jsonb column, so this feature adds no column and needs no migration. That
 * choice has one consequence and it is the reason normalizeLetterheadDesign
 * exists: metadata is a SHARED bag that several unrelated code paths already
 * write their own keys into, and none of them knows about this one. What comes
 * back out of it is therefore untyped by construction. A wrong type, a missing
 * key or a foreign key is an ordinary read, not a corrupted database, and
 * every read of the design goes through normalizeLetterheadDesign, which is
 * the trust boundary for all of it.
 *
 * THIS MODULE IS PURE ON PURPOSE
 * ------------------------------
 * Zero imports, no `server-only`, no React. The preview is a client component
 * and the renderer is a server module, and both need the identical answer to
 * "what lines, in what order, at what weight?". letterheadDesignLines is that
 * single answer. Laying the block out twice is how a preview starts lying
 * about the document, so it is laid out once, here, and read by both.
 *
 * Being pure is also what lets tests/letterhead-design.test.ts drive it
 * directly under vitest's node environment.
 */

export type LetterheadAlignment = 'left' | 'center';

export type LetterheadDesign = {
  firmName: string;
  /** Street, suite, city line, and one spare. Empty entries are dropped. */
  addressLines: string[];
  phone: string;
  email: string;
  website: string;
  /** Free line: bar admissions, registered office, company number. */
  admissionsLine: string;
  alignment: LetterheadAlignment;
  /** Hairline rule under the whole block. */
  showRule: boolean;
};

/** One drawn line of the block, in the order it is drawn. */
export type LetterheadLine = { text: string; size: number; bold: boolean };

/** A firm gets four address lines. A fifth is a paragraph, not a letterhead. */
export const LETTERHEAD_MAX_ADDRESS_LINES = 4;

/**
 * The key inside firms.metadata. Named once so the server actions that write
 * it and the PDF renderer that reads it cannot drift onto two spellings.
 */
export const LETTERHEAD_DESIGN_METADATA_KEY = 'letterhead_design';

const MAX_FIRM_NAME = 120;
const MAX_ADDRESS_LINE = 120;
const MAX_PHONE = 60;
const MAX_EMAIL = 120;
const MAX_WEBSITE = 120;
const MAX_ADMISSIONS = 200;

/** Type sizes, in points, shared by the preview and the PDF. */
export const LETTERHEAD_NAME_SIZE = 16;
export const LETTERHEAD_BODY_SIZE = 9.5;
export const LETTERHEAD_FINE_SIZE = 8.5;

/** What sits between phone, email and website on the contact line. */
const CONTACT_SEPARATOR = '  -  ';

/**
 * Trim and cap one stored value.
 *
 * Non-strings become empty rather than being coerced, which matters: a stored
 * `null` rendered through String() is the word "null" printed on the firm's
 * stationery, and a stored number is a phone number silently reformatted by
 * JavaScript. Empty is the honest answer for "this was not a string".
 */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/**
 * The ONLY reader of `metadata.letterhead_design`.
 *
 * Returns null for anything that is not a usable design, which is the same
 * signal as "this firm has not designed a letterhead": a design with no firm
 * name has nothing to put at the top of a page, so there is no partial state
 * worth carrying forward.
 */
export function normalizeLetterheadDesign(input: unknown): LetterheadDesign | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;

  const firmName = text(raw.firmName, MAX_FIRM_NAME);
  if (!firmName) return null;

  const addressLines = (Array.isArray(raw.addressLines) ? raw.addressLines : [])
    .map((line) => text(line, MAX_ADDRESS_LINE))
    .filter((line) => line.length > 0)
    .slice(0, LETTERHEAD_MAX_ADDRESS_LINES);

  return {
    firmName,
    addressLines,
    phone: text(raw.phone, MAX_PHONE),
    email: text(raw.email, MAX_EMAIL),
    website: text(raw.website, MAX_WEBSITE),
    admissionsLine: text(raw.admissionsLine, MAX_ADMISSIONS),
    alignment: raw.alignment === 'center' ? 'center' : 'left',
    // Defaults ON. A design saved before the flag existed, or restored from a
    // blob that lost it, should look like the letterhead the firm expects
    // rather than quietly losing its rule.
    showRule: typeof raw.showRule === 'boolean' ? raw.showRule : true,
  };
}

/**
 * The design a firm has stored, read out of its `firms.metadata` bag.
 *
 * Every surface that draws a designed letterhead reaches it through here, so
 * the key is spelled once and the untyped bag is narrowed once.
 */
export function firmLetterheadDesign(metadata: unknown): LetterheadDesign | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  return normalizeLetterheadDesign(
    (metadata as Record<string, unknown>)[LETTERHEAD_DESIGN_METADATA_KEY],
  );
}

/**
 * The layout. This is the single place the visual order is decided, so the
 * on-screen preview and the PDF cannot disagree about it.
 *
 * Empty fields produce no line at all rather than a blank one, because a gap
 * in the middle of a letterhead reads as a rendering fault to the person
 * receiving the document.
 */
export function letterheadDesignLines(design: LetterheadDesign): LetterheadLine[] {
  const lines: LetterheadLine[] = [];

  lines.push({ text: design.firmName, size: LETTERHEAD_NAME_SIZE, bold: true });

  for (const line of design.addressLines) {
    if (line) lines.push({ text: line, size: LETTERHEAD_BODY_SIZE, bold: false });
  }

  const contact = [design.phone, design.email, design.website]
    .filter((part) => part.trim().length > 0)
    .join(CONTACT_SEPARATOR);
  if (contact) lines.push({ text: contact, size: LETTERHEAD_BODY_SIZE, bold: false });

  if (design.admissionsLine) {
    lines.push({ text: design.admissionsLine, size: LETTERHEAD_FINE_SIZE, bold: false });
  }

  return lines;
}

/**
 * A model's reply, turned into a design or into nothing.
 *
 * The import flow asks Bella to read the header of an existing letterhead and
 * answer with a JSON object. What actually comes back is a string, and a
 * string is not a promise: it can be prose, a fenced block, a fenced block
 * with prose either side, or valid JSON describing something that is not a
 * letterhead at all.
 *
 * So nothing here trusts the reply. It is narrowed to the outermost braces,
 * parsed inside a try, and then handed to the same normalizer that guards
 * every other read. Null is the only other outcome, which is what lets the
 * caller answer with its own calm sentence: raw model output must never reach
 * a person, because a refusal in the model's voice is not the product's voice.
 */
export function parseLetterheadDesignReply(reply: unknown): LetterheadDesign | null {
  if (typeof reply !== 'string') return null;
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  return normalizeLetterheadDesign(parsed);
}
