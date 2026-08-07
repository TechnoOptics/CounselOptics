import { isReservedFirmKey } from './firm-template-placeholders';

/**
 * What Bella proposes after reading an uploaded document, and every check that
 * is run over it before a person sees it.
 *
 * THE POINT OF THIS MODULE
 * ------------------------
 * The legal team used to retype a document into the editor and hand-write each
 * {{placeholder}}. The import path lets them upload the document they already
 * have. That means a model now writes the body of an instrument that will be
 * signed, and NOTHING it says can be taken at its word: not the field list, not
 * the field types, and above all not how the document leaves the building.
 *
 * So this module is pure and is tested directly. It holds no network call, no
 * database handle and no React. lib/template-intake.ts asks the model; this
 * file decides what survives the answer.
 *
 * WHY THE ONE IMPORT
 * ------------------
 * `isReservedFirmKey` comes from lib/firm-template-placeholders.ts, whose only
 * import is the pure lib/template-field-boxes.ts, so the module graph here is
 * still plain data and vitest loads it under the node environment with no
 * stubbing. Restating the reserved key list locally was the alternative and it
 * is the worse one: a second copy of `firm_name` / `company_name` drifts the
 * first time one of them is edited, and this repo has already paid for that
 * kind of duplicate more than once.
 *
 * The FIELD SHAPE is restated rather than imported. `TemplateField` lives in
 * lib/firm-templates.ts, which carries `'use server'` and drags the
 * service-role Supabase client into anything that touches it. The shape below
 * is structurally identical, so a proposal assigns straight into the editor's
 * `TemplateField[]` with no conversion and no cast.
 *
 * WHERE A SIGNATURE GOES IS ALREADY SETTLED
 * -----------------------------------------
 * A firm template does not carry a signature line in its body. A template
 * whose delivery mode is 'signature' has the block appended at merge time by
 * mergeTemplateDocument, findSignatureBlockLine says where that block is, and
 * lib/signature-geometry.ts says where the mark is drawn. That is three places
 * that already agree, and lib/template-field-boxes.ts exists because a fourth
 * one is how they stopped agreeing last time.
 *
 * So a signature the model finds in the uploaded document is read here as a
 * SIGNAL, not as content: it sets `deliveryMode: 'signature'`, and a
 * signature-shaped placeholder is taken back out of the body. Leaving one in
 * would not be harmless, because the editor derives its field rows FROM the
 * body: `{{employee_signature}}` would come back as a text input in which
 * somebody types a signature.
 */

/**
 * Structurally identical to `TemplateField` in lib/firm-templates.ts. See the
 * header for why it is restated rather than imported.
 *
 * `party` is optional and absent means the employee, matching every existing
 * template. It is left absent rather than defaulted to 'employee' so that the
 * editor keeps its own default in one place.
 */
export type TemplateProposalField = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'textarea';
  required: boolean;
  party?: 'employee' | 'counterparty';
};

export type TemplateProposal = {
  body: string;
  fields: TemplateProposalField[];
  deliveryMode: 'share' | 'signature';
  /** Calm, plain sentences the reviewer is shown above the filled-in editor. */
  notes: string[];
};

/** Matches lib/firm-templates.ts, so a proposal never offers more rows than a
 *  save would keep. */
const MAX_FIELDS = 40;
/** Matches the body cap in createFirmTemplateAction. */
const MAX_BODY_CHARS = 100000;
const MAX_LABEL_CHARS = 80;
const MAX_NOTES = 12;
const MAX_NOTE_CHARS = 300;

/**
 * The placeholder form the editor recognises.
 *
 * Deliberately the same shape as `extractKeys` in
 * app/counsel/forms/forms-manage-client.tsx, because that function is what
 * actually decides which fields the reviewer is shown. A field this module
 * kept but that function cannot see would be silently absent from the editor,
 * and a field this module dropped but that function can see would come back
 * with no settings on it.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * A placeholder that names the signature mark itself, anchored to the end of
 * the key.
 *
 * Anchored on purpose. `signature_date` and `signatory_name` are ordinary
 * blanks a document genuinely asks for, and a looser rule (anything containing
 * "sign") would delete the date an instrument is signed on.
 */
const SIGNATURE_MARK_KEY = /(?:^|_)(?:signature|signatures|initials)$/;

/**
 * A line of the document that IS a signature line, as opposed to one that
 * mentions signing.
 *
 * Anchored at the start of a line and required to be followed by a colon or an
 * underscore run, so "Signed for Acme Ltd" in a recital does not read as an
 * execution block while "Signature: ______" does.
 */
const SIGNATURE_LINE =
  /^[\s>*\-_]*(?:signature|signed(?:\s+by)?|authori[sz]ed\s+signator(?:y|ies)|witness(?:ed)?(?:\s+by)?)\b\s*[:_]/i;

/** The execution clause that carries no colon and is the commonest of all. */
const WITNESS_CLAUSE = /\bin\s+witness\s+whereof\b/i;

/**
 * Pull the JSON object out of a model reply.
 *
 * Models fence code, apologise before the answer and offer to help after it,
 * and none of that is a reason to throw away a good proposal. Every candidate
 * is parsed inside a try, so an unparseable reply is `null` rather than an
 * exception on a server action.
 */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = typeof raw === 'string' ? raw : '';
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate.trim());
      // An array parses fine and would then be read for a `body` it cannot
      // have. Only an object is a proposal.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * The same narrowing `sanitizeFields` (lib/firm-templates.ts) applies on save.
 *
 * Run here as well, and not because the save is untrusted: it is run so the
 * key the reviewer is shown is the key that will be stored. A key repaired
 * only at save time would be checked against the body under one spelling and
 * written under another.
 */
function narrowKey(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function narrowType(raw: unknown): TemplateProposalField['type'] {
  return raw === 'date' || raw === 'textarea' ? raw : 'text';
}

/**
 * Only the two values the editor offers survive; anything else is absent.
 *
 * Absent, and never 'counterparty'. A field wrongly marked as the employee's
 * is a question the colleague gets asked, which is visible and recoverable. A
 * field wrongly marked as the counterparty's is a ruled blank nobody is asked
 * to fill, on a document that has already been approved and sent. That is the
 * same fail-safe direction sanitizeFields takes, for the same reason.
 */
function narrowParty(raw: unknown): TemplateProposalField['party'] {
  if (raw === 'counterparty') return 'counterparty';
  if (raw === 'employee') return 'employee';
  return undefined;
}

function cleanNote(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS) : '';
}

function listKeys(keys: readonly string[]): string {
  return keys.slice(0, 12).join(', ');
}

/**
 * Turn a model reply into a proposal the legal team can review, or null.
 *
 * Null is a supported outcome and means "nothing usable came back". The caller
 * tells the reviewer to type the template by hand, which is exactly what they
 * did before this feature existed, so a null costs them nothing they had.
 */
export function parseTemplateProposal(raw: string): TemplateProposal | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  const notes: string[] = [];

  // 1. The body, with signature placeholders taken back out. See the header:
  //    the signature block is appended at merge time and must not also be a
  //    field, because the editor derives its fields from the body.
  const signatureKeys: string[] = [];
  const bodyText = String(parsed.body ?? '').replace(PLACEHOLDER, (whole, key: string) => {
    const narrowed = key.toLowerCase();
    if (!SIGNATURE_MARK_KEY.test(narrowed)) return whole;
    if (!signatureKeys.includes(narrowed)) signatureKeys.push(narrowed);
    return '';
  });
  const body = bodyText.trim().slice(0, MAX_BODY_CHARS);
  if (!body) return null;

  // 2. Which placeholders the editor will actually find in that body. A field
  //    outside this set has no input behind it, whatever the model claimed.
  const declared = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) declared.add(match[1].toLowerCase());

  // 3. The fields.
  const fields: TemplateProposalField[] = [];
  const seen = new Set<string>();
  const unusable: string[] = [];
  const reserved: string[] = [];
  const rawFields = Array.isArray(parsed.fields) ? parsed.fields.slice(0, MAX_FIELDS) : [];
  for (const entry of rawFields) {
    const field = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const key = narrowKey(field.key);
    if (!key) {
      const shown = String(field.key ?? '').trim().slice(0, 40);
      if (shown) unusable.push(shown);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    // Reserved keys resolve from the firm record at render time. Made editable
    // they become an empty required input AND they disable the substitution
    // the placeholder exists for.
    if (isReservedFirmKey(key)) {
      reserved.push(key);
      continue;
    }
    if (!declared.has(key)) {
      unusable.push(key);
      continue;
    }
    const label = String(field.label ?? '').trim().slice(0, MAX_LABEL_CHARS) || key;
    fields.push({
      key,
      label,
      type: narrowType(field.type),
      required: Boolean(field.required),
      party: narrowParty(field.party),
    });
  }

  // 4. How it goes out. Derived from the body, never read from the reply: a
  //    model that says "signature" is making a claim, and this is the one
  //    place that checks it.
  const signatureLine = body.split('\n').find((line) => SIGNATURE_LINE.test(line));
  const witnessClause = WITNESS_CLAUSE.test(body);
  const deliveryMode: TemplateProposal['deliveryMode'] =
    signatureKeys.length > 0 || signatureLine || witnessClause ? 'signature' : 'share';

  if (signatureLine) {
    notes.push(
      `Found a signature line in the document: "${signatureLine.trim().slice(0, 120)}". ` +
        'This template is set to go out for signature.',
    );
  } else if (witnessClause) {
    notes.push(
      'Found an execution clause ("in witness whereof") in the document. ' +
        'This template is set to go out for signature.',
    );
  }
  if (signatureKeys.length > 0) {
    notes.push(
      `Removed ${signatureKeys.map((k) => `{{${k}}}`).join(', ')} from the body. ` +
        'The signature line is added for you when the document goes out for ' +
        'signature, so it is not a field somebody types into.',
    );
  }
  if (deliveryMode === 'share') {
    notes.push(
      'No signature line was found, so this template is set to go out as a ' +
        'secure read-only link. Change it above if it should be signed.',
    );
  }
  if (reserved.length > 0) {
    notes.push(
      `${listKeys(reserved.map((k) => `{{${k}}}`))} fills itself in from your ` +
        'firm record, so it was left out of the field list.',
    );
  }
  if (unusable.length > 0) {
    notes.push(
      `These suggested fields were left out because the body has no matching ` +
        `placeholder for them: ${listKeys(unusable)}.`,
    );
  }
  if (Array.isArray(parsed.notes)) {
    for (const note of parsed.notes) {
      const cleaned = cleanNote(note);
      if (cleaned) notes.push(cleaned);
    }
  }

  return { body, fields, deliveryMode, notes: notes.slice(0, MAX_NOTES) };
}
