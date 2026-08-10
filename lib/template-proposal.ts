import { isReservedFirmKey, placeholderPattern } from './firm-template-placeholders';

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
 *  save would keep. Applied to what SURVIVES the checks, not to the raw list. */
const MAX_FIELDS = 40;
/** A sanity bound on the raw list, far above any real document, so a
 *  pathological reply cannot make this loop expensive. */
const MAX_FIELD_ENTRIES = 400;
/** Matches the body cap in createFirmTemplateAction. */
const MAX_BODY_CHARS = 100000;
const MAX_LABEL_CHARS = 80;
const MAX_NOTES = 12;
const MAX_NOTE_CHARS = 300;

/**
 * The placeholder form the editor recognises.
 *
 * Anything brace-wrapped the model may have MEANT as a placeholder, which is
 * looser than either `extractKeys` in
 * app/counsel/forms/forms-manage-client.tsx or the merger, on purpose: this is
 * the pattern for finding them in order to REWRITE them into the strict form
 * below. `{{ name }}`, `{{Name}}` and `{{Company Name}}` are all things the
 * merger cannot substitute and would print verbatim on the instrument, and
 * narrowKey turns each of them into a key it can.
 *
 * Inner text is capped and newlines excluded so a stray brace pair in the
 * document cannot swallow a paragraph.
 *
 * THE PATTERN ITSELF NOW LIVES IN lib/firm-template-placeholders.ts, beside
 * the merge it is a statement about, because the editor's save gate asks the
 * same question of a hand-typed body that this asks of a model's. Two
 * definitions of "looks like a placeholder" would let one surface rewrite a
 * token the other never mentions. `placeholderPattern()` hands back a fresh
 * RegExp, so the `lastIndex` this `/g` accumulates stays this module's own.
 */
const LOOSE_PLACEHOLDER = placeholderPattern();

/**
 * The ONLY placeholder form that actually works.
 *
 * mergeTemplateDocument substitutes with `text.split('{{' + f.key + '}}')`,
 * which is exact, case sensitive and whitespace intolerant, and sanitizeFields
 * stores keys narrowed to `[a-z0-9_]` and 40 characters. So `{{ name }}`,
 * `{{Name}}` and a 44-character key are all placeholders the merger cannot
 * match: they print their own braces on the finished instrument, and for a
 * counterparty field they are worse than cosmetic, because no marker is
 * written, so no field box is recorded, so the other side is never given a
 * blank to type into on a document sent for signature.
 *
 * The body is therefore REWRITTEN into this form rather than merely being
 * searched with a looser pattern. Checking fields against the body and never
 * the body against the fields is what let those three through.
 */
const STRICT_PLACEHOLDER = /\{\{([a-z0-9_]{1,40})\}\}/g;

/**
 * Every key the merger will see in this text.
 *
 * Honest note for whoever mutation-tests this: swapping STRICT for LOOSE here
 * fails no test, because step 2 of parseTemplateProposal has already rewritten
 * every rewritable placeholder into the strict form, so on any body this module
 * can produce the two patterns agree. It is kept strict because it states the
 * contract at the point of use, and because the furniture strip below relies on
 * the captured key already being canonical rather than lowercasing it again.
 * It is a redundant safety net, not an untested guard.
 */
function placeholderKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const match of text.matchAll(STRICT_PLACEHOLDER)) keys.add(match[1]);
  return keys;
}

/**
 * EXECUTION FURNITURE: the parts of a document the platform supplies itself.
 *
 * mergeTemplateDocument appends a signature line AND a date line for the
 * employee, and a second block for the counterparty when the template goes out
 * for signature. So anything in the uploaded document that does the same job is
 * a duplicate, and a duplicate is not cosmetic: a second ruled line gives a
 * signer somewhere to sign that is never stamped and never recorded, and a
 * second date blank puts two dates per party on an executed instrument with no
 * rule about which one governs. Both were seen on a real upload.
 *
 * The two rules below are anchored at the end of the key so they catch the
 * furniture and nothing else: `signature_date` and `company_signature_date` are
 * the block's own date, while `effective_date`, `start_date` and
 * `signatory_name` are blanks the instrument genuinely asks for.
 */
const SIGNATURE_MARK_KEY = /(?:^|_)(?:signature|signatures|initials)$/;
const SIGNATURE_DATE_KEY = /(?:^|_)(?:signature|signing|signed|execution)_date$|_date_signed$|^date_signed$/;

function isExecutionFurnitureKey(key: string): boolean {
  return SIGNATURE_MARK_KEY.test(key) || SIGNATURE_DATE_KEY.test(key);
}

/**
 * A ruled blank: six or more underscores.
 *
 * Six is not arbitrary. lib/template-field-boxes.ts sets its counterparty
 * marker to a run of FIVE, deliberately under the six that
 * lib/signature-anchors.ts treats as a signature line, so this threshold is the
 * one the rest of the product already draws the line at. A run this long in an
 * uploaded document is a place somebody was meant to sign or write on a rule.
 */
const RULED_BLANK = /_{6,}/;
const RULED_BLANK_ALL = /_{6,}/g;

/**
 * What makes a ruled blank a place to SIGN rather than a term to fill in.
 *
 * A run of underscores is not by itself execution furniture. "The Term of this
 * Agreement is ______ months" and "the fee is $______ per month" are operative
 * blanks, and deleting them loses a term of the agreement while the note calls
 * it a signature rule, so the reviewer never goes looking. Each blank is judged
 * by its own surroundings, not by the document as a whole.
 *
 * The window is characters rather than lines on purpose: extractFileText
 * returns a PDF as ONE line, so a line-based context would be the whole
 * document on exactly the uploads that matter.
 */
const EXECUTION_BEFORE =
  /(?:^|[\s>*\-(])(?:by|signature|signed|sign|witness|name|title|per|its|for|printed)\s*:?\s*$/i;
const EXECUTION_AFTER = /^\s*(?:name|title|date|printed?|print name|address|e-?mail|its|witness)\s*:/i;
const CONTEXT_BEFORE_CHARS = 60;
const CONTEXT_AFTER_CHARS = 40;

/**
 * Remove the ruled blanks a party signs on, and only those.
 *
 * Only the rule is ever removed, never the line it sits on: "By: ______"
 * becomes "By:", which a reviewer can see and delete. Taking the line would
 * take the clause text with it.
 */
function stripExecutionRules(text: string): { text: string; removed: number; kept: string[] } {
  const kept: string[] = [];
  let removed = 0;
  const out = text.replace(RULED_BLANK_ALL, (run: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - CONTEXT_BEFORE_CHARS), offset);
    const after = text.slice(offset + run.length, offset + run.length + CONTEXT_AFTER_CHARS);
    if (EXECUTION_BEFORE.test(before) || EXECUTION_AFTER.test(after)) {
      removed += 1;
      return '';
    }
    kept.push(`${before.slice(-32).trimStart()}${run.slice(0, 8)}${after.slice(0, 16).trimEnd()}`);
    return run;
  });
  return { text: out, removed, kept };
}

/**
 * A non-reserved key for a placeholder the model aimed at the other side.
 *
 * Prefixed rather than invented, so the reviewer can see which placeholder it
 * came from, and checked against everything already in the body so a rename
 * cannot collide two different blanks into one.
 */
function safeCounterpartyKey(key: string, taken: ReadonlySet<string>): string {
  const base = `counterparty_${key}`.slice(0, 40);
  if (!taken.has(base) && !isReservedFirmKey(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base.slice(0, 37)}_${n}`.slice(0, 40);
    if (!taken.has(candidate) && !isReservedFirmKey(candidate)) return candidate;
  }
  return base;
}

/**
 * A line of the document that IS a signature line.
 *
 * Anchored at the start of a line and required to be followed by a colon or an
 * underscore, so "Signed for Acme Ltd" in a recital does not read as an
 * execution block while "Signature: ______" does. Kept for well-formed text,
 * where it yields a line worth quoting back to the reviewer.
 *
 * It CANNOT be the only rule. extractFileText reads a PDF through unpdf with
 * `mergePages: true`, which returns the whole instrument as one line with no
 * newlines in it at all, so an anchored scan matches nothing on any real
 * uploaded agreement. That is exactly how a mutual NDA carrying two signature
 * blocks came back classified as a read-only share. The unanchored rules below
 * are what actually fire on an upload.
 */
const SIGNATURE_LINE =
  /^[\s>*\-_]*(?:signature|signed(?:\s+by)?|authori[sz]ed\s+signator(?:y|ies)|witness(?:ed)?(?:\s+by)?)\b\s*[:_]/i;

/** "Signature:" anywhere in the text, newlines or not. */
const SIGNATURE_COLON = /\bsignatures?\s*:/i;

/** The execution clause that carries no colon and is the commonest of all. */
const WITNESS_CLAUSE = /\bin\s+witness\s+whereof\b/i;

/** A document that refers to its own signature page has one. */
const SIGNATURE_PAGE = /\bsignature page\b/i;

/**
 * What in this text says the document is signed, described for the reviewer,
 * or null if nothing does.
 *
 * Run over the model's proposed body AND over the source text it was given,
 * because the model choosing not to emit an execution page is not evidence that
 * the document has none. The source is the document; the reply is a claim about
 * it.
 *
 * Erring toward signature is the fail-safe direction here, and the asymmetry is
 * the whole reason this is checked twice. A document wrongly set to signature
 * shows the reviewer a select they can change. A document wrongly set to share
 * goes out as a read-only link that renders the counterparty's blanks as
 * markers on the page the recipient reads, and nobody is asked to sign the
 * thing the firm uploaded in order to have signed.
 */
function describeSignatureEvidence(text: string): string | null {
  if (!text) return null;
  const line = text.split('\n').find((l) => SIGNATURE_LINE.test(l));
  if (line) return `a signature line ("${line.trim().slice(0, 80)}")`;
  if (SIGNATURE_COLON.test(text)) return 'a "Signature:" line';
  if (RULED_BLANK.test(text)) return 'a ruled blank for a signature';
  if (WITNESS_CLAUSE.test(text)) return 'the words "in witness whereof"';
  if (SIGNATURE_PAGE.test(text)) return 'a reference to a signature page';
  return null;
}

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
export function parseTemplateProposal(
  raw: string,
  /**
   * The document text the model was given, when the caller has it. Optional so
   * a test can drive the reply alone, but lib/template-intake.ts always passes
   * it: the source is the only unedited account of what the document contains.
   */
  source?: string,
): TemplateProposal | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  const notes: string[] = [];

  // 1. Evidence FIRST, over the body exactly as the model wrote it. Step 2
  //    removes the execution furniture, so anything read afterwards would be
  //    reading a body this function had already cleaned.
  const rawBody = String(parsed.body ?? '');
  const evidence = describeSignatureEvidence(rawBody) ?? describeSignatureEvidence(String(source ?? ''));

  // 2. Rewrite every placeholder into the one form the merger can substitute.
  //    See STRICT_PLACEHOLDER: this is the direction the module was missing.
  let rewritten = 0;
  let bodyText = rawBody.replace(LOOSE_PLACEHOLDER, (whole: string, token: string) => {
    const key = narrowKey(token);
    // Nothing legal left in it, so it is not a placeholder and not ours to
    // rewrite. It stays as the text the model wrote.
    if (!key) return whole;
    const canonical = `{{${key}}}`;
    if (canonical !== whole) rewritten += 1;
    return canonical;
  });

  const rawFields = (Array.isArray(parsed.fields) ? parsed.fields : []).slice(0, MAX_FIELD_ENTRIES);
  const asObject = (entry: unknown): Record<string, unknown> =>
    (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;

  // 3. A reserved key the model aimed at the OTHER side is renamed, in the
  //    body and in the field list.
  //
  //    Dropping the field was not enough, which is how this was found:
  //    mergeTemplateDocument substitutes a reserved key that no field declares
  //    with the firm's OWN name, wherever it sits, so the real NDA merged to
  //    "between Zinpro Corporation and Anderson Foundation". The firm named as
  //    its own counterparty is the failure RESERVED_FIRM_KEYS records having
  //    already reached a client.
  //
  //    Only when the model said `party: 'counterparty'`. That declaration is
  //    what makes the repair safe: a reserved key with any other party may
  //    genuinely be the firm, and there the self-filling substitution is the
  //    designed behaviour and renaming it would break it.
  const renames = new Map<string, string>();
  const takenKeys = new Set(placeholderKeys(bodyText));
  for (const entry of rawFields) {
    const field = asObject(entry);
    const key = narrowKey(field.key);
    if (!key || renames.has(key)) continue;
    if (!isReservedFirmKey(key) || !takenKeys.has(key)) continue;
    if (narrowParty(field.party) !== 'counterparty') continue;
    const safe = safeCounterpartyKey(key, takenKeys);
    takenKeys.add(safe);
    renames.set(key, safe);
  }
  for (const [from, to] of renames) {
    bodyText = bodyText.split(`{{${from}}}`).join(`{{${to}}}`);
  }

  // 4. The execution furniture out. See the header: mergeTemplateDocument
  //    appends the signature and date lines, and the editor derives its fields
  //    FROM the body, so a placeholder left here comes back as an input
  //    somebody types a signature into.
  const furnitureKeys: string[] = [];
  bodyText = bodyText.replace(STRICT_PLACEHOLDER, (whole: string, key: string) => {
    if (!isExecutionFurnitureKey(key)) return whole;
    if (!furnitureKeys.includes(key)) furnitureKeys.push(key);
    return '';
  });
  const rules = stripExecutionRules(bodyText);
  bodyText = rules.text;

  const body = bodyText.trim().slice(0, MAX_BODY_CHARS);
  if (!body) return null;

  // 5. Which placeholders the merger will actually find in that body. A field
  //    outside this set has no input behind it, whatever the model claimed.
  const declared = placeholderKeys(body);

  // 6. The fields. FILTERED first and capped afterwards, because capping the
  //    raw list let junk consume every slot: forty entries with no placeholder
  //    behind them crowded out two real fields and nothing was reported, and
  //    the editor then re-derived both from the body with default settings,
  //    silently turning a counterparty blank into one the employee is asked to
  //    fill.
  const kept: TemplateProposalField[] = [];
  const seen = new Set<string>();
  const unusable: string[] = [];
  const reserved: string[] = [];
  for (const entry of rawFields) {
    const field = asObject(entry);
    const narrowed = narrowKey(field.key);
    if (!narrowed) {
      const shown = String(field.key ?? '').trim().slice(0, 40);
      if (shown) unusable.push(shown);
      continue;
    }
    const key = renames.get(narrowed) ?? narrowed;
    if (seen.has(key)) continue;
    seen.add(key);
    // Reserved keys resolve from the firm record at render time. Made editable
    // they become an empty required input AND they disable the substitution
    // the placeholder exists for. Anything renamed above is no longer one.
    if (isReservedFirmKey(key)) {
      reserved.push(key);
      continue;
    }
    if (!declared.has(key)) {
      // Execution furniture was taken out of the body a few lines above, and
      // the note about that already explains where it went. Reporting it a
      // second time as a placeholder the body lacks would send the reviewer
      // looking for a blank that was never missing.
      if (!furnitureKeys.includes(key)) unusable.push(key);
      continue;
    }
    const label = String(field.label ?? '').trim().slice(0, MAX_LABEL_CHARS) || key;
    kept.push({
      key,
      label,
      type: narrowType(field.type),
      required: Boolean(field.required),
      party: narrowParty(field.party),
    });
  }
  const overflow = Math.max(0, kept.length - MAX_FIELDS);
  const fields = kept.slice(0, MAX_FIELDS);

  // 5. How it goes out. Derived from the document, never read from the reply:
  //    a model that says "signature" is making a claim, and this is the one
  //    place that checks it. Removed furniture counts as evidence in its own
  //    right, since a placeholder for a signature is only ever put where one
  //    was.
  //    A ruled blank is not tested again here: `evidence` was taken from the
  //    body BEFORE the rules were stripped out of it, which is what makes that
  //    ordering load-bearing rather than incidental.
  const deliveryMode: TemplateProposal['deliveryMode'] =
    furnitureKeys.length > 0 || evidence ? 'signature' : 'share';

  if (deliveryMode === 'signature') {
    notes.push(
      'This template is set to go out for signature' +
        (evidence ? `, because the document carries ${evidence}` : '') +
        '. Change it above if that is wrong.',
    );
  }
  if (rules.removed > 0) {
    notes.push(
      `Removed ${rules.removed} ruled blank${rules.removed === 1 ? '' : 's'} that sat where ` +
        'the document is signed, such as the rule after "By:". The signature ' +
        'and date lines are added for you when the document goes out, and a ' +
        'second rule on the page would be a place to sign that nothing records.',
    );
  }
  if (rules.kept.length > 0) {
    // Named, and left in place. A blank that is not a signature line is a term
    // of the agreement, and a reviewer told it was a signature rule would never
    // go looking for it.
    notes.push(
      `Left ${rules.kept.length} blank${rules.kept.length === 1 ? '' : 's'} in the body that ` +
        `do not look like signature lines: ${rules.kept.slice(0, 3).map((k) => `"${k.trim()}"`).join(', ')}. ` +
        'If somebody should fill those in, give each one a {{placeholder}} and it ' +
        'becomes a field.',
    );
  }
  if (rewritten > 0) {
    notes.push(
      `Rewrote ${rewritten} placeholder${rewritten === 1 ? '' : 's'} into the form the ` +
        'document merge understands, all lowercase with no spaces inside the ' +
        'braces. A placeholder in any other form prints on the finished ' +
        'document exactly as it is written.',
    );
  }
  if (renames.size > 0) {
    notes.push(
      `${[...renames].map(([from, to]) => `{{${from}}} was renamed to {{${to}}}`).join(', ')}. ` +
        'The old name fills itself in with your own firm name everywhere it ' +
        'appears, and Bella marked this one as the other side, so leaving it ' +
        'would have named your firm as its own counterparty.',
    );
  }
  if (overflow > 0) {
    notes.push(
      `This document produced more fields than a template can hold, so only the ` +
        `first 40 were kept and ${overflow} more were left out. Check the end of ` +
        'the body for blanks that now have no field.',
    );
  }
  if (furnitureKeys.length > 0) {
    notes.push(
      `Removed ${furnitureKeys.map((k) => `{{${k}}}`).join(', ')} from the body. ` +
        'The signature and date lines are added for you when the document goes ' +
        'out for signature, so they are not fields somebody types into.',
    );
  }
  if (deliveryMode === 'share') {
    notes.push(
      'No signature line was found, so this template is set to go out as a ' +
        'secure read-only link. Change it above if it should be signed.',
    );
  }
  if (reserved.length > 0) {
    // Not merely "it was left out". Dropping the FIELD does not stop the
    // PLACEHOLDER: mergeTemplateDocument substitutes a reserved key that no
    // field declares with the firm's own name, wherever it sits in the body.
    // A model reading a mutual NDA proposed {{company_name}} for the OTHER
    // side, which left alone would have named the firm as its own
    // counterparty. That is the failure the RESERVED_FIRM_KEYS comment records
    // having already shipped once, so the reviewer is told what to do about it
    // rather than told the field is gone.
    notes.push(
      `${listKeys(reserved.map((k) => `{{${k}}}`))} fills itself in with your ` +
        'own firm name everywhere it appears in the body, so it was left out ' +
        'of the field list. If it was meant to be the other side, rename it in ' +
        'the body before you save, for example to {{counterparty_name}}.',
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
