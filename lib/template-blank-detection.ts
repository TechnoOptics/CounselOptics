/**
 * Where a document asks somebody to write, and where it asks somebody to sign.
 *
 * WHY THIS MODULE EXISTS AT ALL
 * -----------------------------
 * Every field on a firm template is derived FROM the body: extractKeys in
 * app/counsel/forms/forms-manage-client.tsx reads `{{key}}` out of the text and
 * that list IS the field list, which is then what an employee sees in the fill
 * panel on app/portal/forms/[id] and what the other side is given a blank for
 * on the signing page. There is no second place a field can come from, and
 * lib/template-field-boxes.ts is emphatic that there must not be one.
 *
 * So an author who pastes the agreement their firm already uses gets NOTHING.
 * The document is full of "Name: ______" and "By: ______" and not one of them
 * is a `{{placeholder}}`, so the field list is empty and every blank has to be
 * found by eye and retyped by hand.
 *
 * THE RULES BELOW ARE NOT NEW. They were written for lib/template-proposal.ts,
 * which reads an uploaded document through a model and proposes a template from
 * it. They ran there and only there, which meant they were unreachable without
 * a paid generation, a file upload, and the rate limit that guards both. They
 * now live here, template-proposal.ts imports them, and the editor runs them
 * over whatever body is on screen. Two copies of "this is a signature line" is
 * how the import path and the editor come to disagree about one document, which
 * is the same reasoning that put placeholderPattern() in
 * lib/firm-template-placeholders.ts.
 *
 * WHAT IS DETECTED AND WHAT IS NOT
 * --------------------------------
 * This reads TEXT. A firm template body is a text column, so that is the whole
 * of the format question for this path: a body typed in, pasted in, or produced
 * by extractFileText from a PDF, a .docx or a .txt. It does not read PDF
 * geometry and it knows nothing about AcroForm fields; that is
 * lib/signature-anchors.ts, which works on the bytes of a signing request and is
 * a different path with a different input.
 *
 * The character windows below are characters and not lines ON PURPOSE.
 * extractFileText reads a PDF through unpdf with `mergePages: true`, which
 * returns the entire instrument as one line with no newlines in it, so a
 * line-based rule matches nothing on exactly the documents that matter. That is
 * recorded in lib/template-proposal.ts as the way a mutual NDA carrying two
 * signature blocks came back classified as a read-only share.
 *
 * NOTHING HERE DECIDES ANYTHING
 * -----------------------------
 * Every function is pure and every return value is a SUGGESTION. Nothing in
 * this module edits a body, adds a field, or changes a delivery mode. The
 * editor renders what comes back, an author presses a button, and the button is
 * what writes. That ordering is the whole safety argument: a blank this file
 * misses costs an author one hand-typed placeholder, which is what they do
 * today, and a blank it invents costs nothing at all until somebody agrees with
 * it.
 */

/**
 * A ruled blank: six or more underscores.
 *
 * Six is not arbitrary. lib/template-field-boxes.ts sets its counterparty
 * marker to a run of FIVE, deliberately under the six that
 * lib/signature-anchors.ts treats as a signature line, so this threshold is the
 * one the rest of the product already draws the line at. A run this long in a
 * document is a place somebody was meant to sign or write on a rule.
 */
export const RULED_BLANK = /_{6,}/;
const RULED_BLANK_ALL = /_{6,}/g;

/**
 * What makes a ruled blank a place to SIGN rather than a term to fill in.
 *
 * A run of underscores is not by itself execution furniture. "The Term of this
 * Agreement is ______ months" and "the fee is $______ per month" are operative
 * blanks, and deleting them loses a term of the agreement while the note calls
 * it a signature rule, so the reviewer never goes looking. Each blank is judged
 * by its own surroundings, not by the document as a whole.
 */
export const EXECUTION_BEFORE =
  /(?:^|[\s>*\-(])(?:by|signature|signed|sign|witness|name|title|per|its|for|printed)\s*:?\s*$/i;
export const EXECUTION_AFTER = /^\s*(?:name|title|date|printed?|print name|address|e-?mail|its|witness)\s*:/i;
export const CONTEXT_BEFORE_CHARS = 60;
export const CONTEXT_AFTER_CHARS = 40;

/**
 * Remove the ruled blanks a party signs on, and only those.
 *
 * Only the rule is ever removed, never the line it sits on: "By: ______"
 * becomes "By:", which a reviewer can see and delete. Taking the line would
 * take the clause text with it.
 *
 * Used by the import path only. The editor does not call this: stripping
 * underscores out of a body an author is looking at is a silent edit to legal
 * text, and the editor offers a per-blank button instead.
 */
export function stripExecutionRules(text: string): {
  text: string;
  removed: number;
  kept: string[];
} {
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
 * A line of the document that IS a signature line.
 *
 * Anchored at the start of a line and required to be followed by a colon or an
 * underscore, so "Signed for Acme Ltd" in a recital does not read as an
 * execution block while "Signature: ______" does. Kept for well-formed text,
 * where it yields a line worth quoting back to the reviewer.
 *
 * It CANNOT be the only rule; see the module header on `mergePages: true`.
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
 * What in this text says the document is signed, described for the reader, or
 * null if nothing does.
 *
 * Erring toward signature is the fail-safe direction, and that asymmetry is why
 * lib/template-proposal.ts runs it twice, over the model's body and over the
 * source. A document wrongly set to signature shows a select somebody can
 * change. A document wrongly set to share goes out as a read-only link that
 * renders the counterparty's blanks as markers on the page the recipient reads,
 * and nobody is asked to sign the thing the firm uploaded in order to have
 * signed.
 */
export function describeSignatureEvidence(text: string): string | null {
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
 * The same narrowing `sanitizeFields` (lib/firm-templates.ts) applies on save.
 *
 * Here so that the key a person is SHOWN is the key that will be stored. A key
 * repaired only at save time would be checked against the body under one
 * spelling and written under another.
 */
export function narrowKey(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// ---------------------------------------------------------------------
// Detection over an editor body
// ---------------------------------------------------------------------

/**
 * Where a signature label sits directly in front of a rule.
 *
 * Deliberately much tighter than EXECUTION_BEFORE, which is the rule for "this
 * blank is somewhere inside an execution block" and correctly includes `name`,
 * `title` and `printed`. Those are blanks a person WRITES in, and calling one a
 * signature would lose a field the instrument genuinely asks for. This list is
 * only the labels that mean the mark itself.
 *
 * "Per" and "Its" are left out on purpose. In a US block "Its:" is the office
 * held and in a Canadian one "Per:" is the signature, and a rule that cannot
 * tell those apart should not be the one deciding which blanks disappear.
 */
const SIGNATURE_LABEL =
  /^(?:by|signature(?:\s+of\b.*)?|signatures|signed(?:\s+by)?|sign(?:\s+here)?|witness(?:ed\s+by)?|authori[sz]ed\s+signature|authori[sz]ed\s+signator(?:y|ies))$/i;

/**
 * The conformed-signature mark, which carries no label a colon rule can find.
 *
 * "/s/ ______" is how an execution block is written when it is typed rather
 * than drawn, and it starts with a character LABEL_BEFORE cannot begin a label
 * with, so it needs its own test rather than a spelling in the list above.
 */
const CONFORMED_MARK = /\/s\/\s*:?\s*$/;

/** A label that names the date of signing, which the platform supplies. */
const SIGNING_DATE_LABEL =
  /^(?:date\s+signed|signed\s+on|date\s+of\s+signature|date\s+of\s+signing|signature\s+date|signing\s+date|execution\s+date|dated)$/i;

/**
 * The label immediately before a rule: "Effective Date:", "By:", "Print Name:".
 *
 * NOT a single regex, and the first version was, which is why this is written
 * out. A pattern like `/([A-Za-z][\w ]{0,48})\s*:\s*$/` matches leftmost-first,
 * so on "This Agreement is effective on Effective Date: ______" it captures the
 * whole clause and proposes a forty-character key made of a sentence. A label
 * is a short phrase sitting after a real boundary, and both halves of that have
 * to be enforced.
 *
 * The boundary set includes the UNDERSCORE, which is not decoration: on a PDF
 * read with `mergePages: true` the whole instrument is one line, so the
 * characters before "Name:" are the previous blank's own rule and nothing else
 * would separate the two.
 */
const LABEL_BOUNDARY = /[\n\r\t._;:!?)\]}"“”]|\s{2,}/g;

/** Longest a label may be, in words. Four covers "Name of Authorized
 *  Representative" and excludes the clause that swallowed one. */
const LABEL_MAX_WORDS = 4;

function labelBefore(before: string, atBodyStart: boolean): string | null {
  const tail = before.replace(/\s+$/, '');
  if (!tail.endsWith(':')) return null;
  const seg = tail.slice(0, -1);
  let from = -1;
  const re = new RegExp(LABEL_BOUNDARY.source, 'g');
  let m = re.exec(seg);
  while (m) {
    from = m.index + m[0].length;
    m = re.exec(seg);
  }
  // No boundary at all means the label would have to start where the window
  // was cut, and a window cut mid-sentence starts nowhere in particular. Only
  // a window that is genuinely the start of the body may be read that way.
  if (from < 0) {
    if (!atBodyStart) return null;
    from = 0;
  }
  // The dashes are escaped rather than written, because a literal one in the
  // source would be the only em dash in the repo and the next person to sweep
  // for them would have to work out whether it was prose. Documents use both
  // as bullets, so both are stripped.
  const candidate = seg.slice(from).replace(/^[\s>*\-\u2013\u2014]+/, '').trim();
  if (!candidate || !HAS_LETTER.test(candidate)) return null;
  if (candidate.split(/\s+/).length > LABEL_MAX_WORDS) return null;
  return candidate;
}

/**
 * A parenthetical label immediately after a rule: "______ (Print Name)".
 *
 * Only the parenthetical form is read from the right. A bare word after a rule
 * is far more often the label of the NEXT blank in the block than of this one,
 * and mislabelling a blank is worse than leaving it unnamed: an unnamed blank is
 * reported and left alone, while a mislabelled one is offered as a field with a
 * key that describes a different part of the agreement.
 */
const LABEL_AFTER = /^\s*\(([^)\n]{1,48})\)/;

/** A label made only of punctuation or digits names nothing. */
const HAS_LETTER = /[A-Za-z]/;

/**
 * The labels that appear on the lines of an execution block.
 *
 * Wider than EXECUTION_BEFORE and separate from it on purpose, twice over.
 * EXECUTION_BEFORE decides what the IMPORT path DELETES, so widening it would
 * change which rules disappear from an uploaded document, and it has no `date`
 * in it precisely because a date is usually a term of the agreement. This rule
 * decides only whether to show a sentence, alongside a proximity test that has
 * already established there is a signature within a few lines, so it can afford
 * `date` and `address` where the strip rule cannot.
 *
 * Anchored at the start of the label so "Counterparty Name" is not read as
 * "Name" and "Effective Date" is not read as "Date". Those two are the fields
 * a real NDA most obviously wants, and both were being warned about.
 */
const EXECUTION_BLOCK_LABEL =
  /^(?:by|signature|signed|sign|witness(?:ed)?|name|printed?\s*name|title|its|per|for|date|dated|address|e-?mail|attest)\b/i;

export type DetectedBlankKind =
  /** A place a person writes something. Can become a field. */
  | 'fill'
  /** A place a person signs. The platform supplies the block; never a field. */
  | 'signature';

export type DetectedBlank = {
  kind: DetectedBlankKind;
  /** Index of the underscore run in the body it was detected in. */
  index: number;
  /** The run itself, so a caller can confirm the body has not moved under it. */
  raw: string;
  /** The label as the document wrote it, or null when the blank has none. */
  label: string | null;
  /**
   * The placeholder key this blank would become, or null when it has no label
   * to make one from. Null is what makes a blank un-addable rather than
   * addable under an invented name.
   */
  key: string | null;
  /** What the field would be, on the same "contains date" reading the editor
   *  already uses for a hand-typed key. */
  type: 'text' | 'date';
  /**
   * True when this blank sits inside an execution block: near a place somebody
   * signs, AND labelled like part of one. A `fill` blank with this set is very
   * often the printed name or the date under a signature, both of which
   * mergeTemplateDocument appends itself, so the author is warned rather than
   * having it decided for them.
   *
   * BOTH HALVES ARE REQUIRED, and the second half was added after reading the
   * output on a real mutual NDA. The label rule alone (EXECUTION_BEFORE, which
   * the import path strips a rule on) matches "Counterparty Name:" in the
   * PREAMBLE, because it ends in "Name:". That put a warning about signature
   * blocks on the single most obviously wanted field in the document, and a
   * warning that fires on the preamble is one an author learns to scroll past.
   * The same read found the opposite miss: the "Date:" line inside the first
   * execution block is not matched by the label rule at all, because `date` is
   * not in it, so the signing date was offered as an ordinary field with
   * nothing said.
   */
  inExecutionBlock: boolean;
  /** The document either side of the blank, for an author who has to find it. */
  context: string;
};

/** Longest body this will scan. Past this the editor shows what it found so
 *  far and says so, rather than walking a pasted book on every keystroke. */
export const DETECTION_BODY_MAX = 200000;

/**
 * Every ruled blank in a template body, classified and named where it can be.
 *
 * Returned in the order they appear in the document, because that is the order
 * an author reads their own agreement in, and a list in any other order is one
 * they have to search rather than follow.
 *
 * Keys are deduplicated against the placeholders the body ALREADY declares and
 * against each other, so the two "Name: ______" blanks in a mutual NDA become
 * `name` and `name_2` rather than one field that fills both parties in with the
 * same words.
 */
export function detectTemplateBlanks(body: unknown): DetectedBlank[] {
  const text = typeof body === 'string' ? body.slice(0, DETECTION_BODY_MAX) : '';
  if (!text) return [];

  const taken = new Set<string>();
  for (const m of text.matchAll(/\{\{([a-z0-9_]{1,40})\}\}/g)) taken.add(m[1]);

  // Pass one: find and classify every rule. Whether a blank sits in an
  // execution block cannot be answered here, because it depends on where the
  // OTHER blanks turned out to be.
  type Found = Omit<DetectedBlank, 'inExecutionBlock'> & { labelled: boolean };
  const found: Found[] = [];
  const re = new RegExp(RULED_BLANK_ALL.source, 'g');
  let m = re.exec(text);
  while (m) {
    const run = m[0];
    const index = m.index;
    const before = text.slice(Math.max(0, index - CONTEXT_BEFORE_CHARS), index);
    const after = text.slice(index + run.length, index + run.length + CONTEXT_AFTER_CHARS);

    const fromLeft = labelBefore(before, index <= CONTEXT_BEFORE_CHARS);
    const fromRight = fromLeft ? null : (LABEL_AFTER.exec(after)?.[1]?.trim() ?? null);
    const rawLabel = fromLeft ?? fromRight;
    const label = rawLabel && HAS_LETTER.test(rawLabel) ? rawLabel : null;

    const isSignature =
      CONFORMED_MARK.test(before) ||
      (label !== null && (SIGNATURE_LABEL.test(label) || SIGNING_DATE_LABEL.test(label)));

    // A signature place is never offered as a field, so it is never given a
    // key. mergeTemplateDocument appends the signature and date lines itself
    // and lib/signature-geometry.ts is the only thing that says where the mark
    // is drawn; a `{{signature}}` field would be a text input somebody types a
    // signature into, which is the exact defect lib/template-proposal.ts strips
    // out of an imported body.
    let key: string | null = null;
    if (!isSignature && label) {
      const base = narrowKey(label);
      if (base) key = uniqueKey(base, taken);
      if (key) taken.add(key);
    }

    found.push({
      kind: isSignature ? 'signature' : 'fill',
      index,
      raw: run,
      label,
      key,
      // The same reading the editor applies to a hand-typed key, so a blank
      // that becomes a field gets the type it would have got either way.
      type: label && /date/i.test(label) ? 'date' : 'text',
      context: quoteContext(before, run, after),
      labelled:
        (label !== null && EXECUTION_BLOCK_LABEL.test(label)) ||
        EXECUTION_BEFORE.test(before) ||
        EXECUTION_AFTER.test(after),
    });
    m = re.exec(text);
  }

  // Pass two: the anchors an execution block is recognised BY, which is the
  // half the label rule cannot supply. A signature-classified rule is the
  // strongest; "in witness whereof" covers the block that opens before its
  // first rule.
  const anchors: number[] = found.filter((f) => f.kind === 'signature').map((f) => f.index);
  for (const w of text.matchAll(/\bin\s+witness\s+whereof\b/gi)) anchors.push(w.index);

  return found.map((f) => ({
    kind: f.kind,
    index: f.index,
    raw: f.raw,
    label: f.label,
    key: f.key,
    type: f.type,
    inExecutionBlock:
      f.labelled && anchors.some((a) => Math.abs(a - f.index) <= EXECUTION_BLOCK_REACH),
    context: f.context,
  }));
}

/**
 * How far from a signature an execution block reaches, in characters.
 *
 * Three hundred is about the distance from "By:" to the "Date:" underneath it
 * with two more labelled rules in between, and comfortably short of the
 * distance from a preamble to the execution page of anything worth signing. It
 * is measured in characters rather than lines for the reason the whole module
 * is: a PDF read with `mergePages: true` has no lines.
 */
const EXECUTION_BLOCK_REACH = 300;

/**
 * The words either side of a rule, as a person would quote them to find it.
 *
 * A blind slice of the preceding characters was the first version and it read
 * badly on a rendered page, which is where this was rewritten from. Two
 * different "By:" rules in a mutual NDA both came back as
 * "…____________ COUNTERPARTY By: ________ Name: ________": each fragment
 * carried the tail of the PREVIOUS blank's rule, ran on into the NEXT blank's
 * label, and buried the one word that told the two apart.
 *
 * So the quote starts at the nearest thing a reader recognises as a beginning:
 * the last paragraph break, which on a normal document is the party heading
 * above the block, or failing that the end of the previous rule, which is what
 * a PDF read as one line has instead. It stops at the end of the line the rule
 * is on. Leading punctuation is dropped, because a quote opening on a full stop
 * from the previous sentence looks like a typo rather than a location.
 */
function quoteContext(before: string, run: string, after: string): string {
  let head: string;
  // The SECOND to last paragraph break, not the last, so one paragraph of
  // lead-in survives. Cutting at the last one leaves "By: ________" for both
  // parties of a mutual agreement and throws away the heading above each block,
  // which is the only thing that tells them apart.
  const paragraphs = [...before.matchAll(/\n[^\S\n]*\n/g)];
  const lead = paragraphs.length >= 2 ? paragraphs[paragraphs.length - 2] : null;
  head = lead ? before.slice(lead.index + lead[0].length) : before;
  // Then never across another rule, whichever way the lead-in was chosen. The
  // paragraph cut alone left the counterparty block's "Name:" quote opening on
  // thirty-one underscores belonging to the "By:" line above it.
  const priorRule = [...head.matchAll(/_{6,}/g)].pop();
  if (priorRule) head = head.slice(priorRule.index + priorRule[0].length);
  if (head.length > 40) {
    // Cut to length, then forward to the next whole word. A quote opening on
    // "he other. The term of this Agreement is" reads as a rendering fault
    // rather than as a place in the document.
    head = head.slice(-40).replace(/^\S+\s/, '');
  }
  const tail = after.split(/[\n\r]/)[0].slice(0, 16);
  return `${head}${run.slice(0, 8)}${tail}`
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:)\]}]+/, '')
    .trim();
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string | null {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base.slice(0, 37)}_${n}`.slice(0, 40);
    if (!taken.has(candidate)) return candidate;
  }
  // A hundred blanks sharing one label is not a document this should guess at.
  return null;
}

/**
 * The body with one detected blank turned into the placeholder that makes it a
 * field, or null when the suggestion no longer fits the body.
 *
 * NULL IS THE POINT OF THE SLICE CHECK. The offsets came from a scan of some
 * body, and the author may have typed since. Writing at a stale offset would
 * put a placeholder in the middle of a sentence of an instrument, which is the
 * one outcome worse than not offering the button at all. The caller shows the
 * list recomputed from the current body on every render, so this should never
 * fire; it fires anyway rather than trusting that it cannot.
 *
 * Only the underscore run is replaced. The label beside it is the document's
 * own words: "Name: ______" becomes "Name: {{name}}", and the author keeps the
 * sentence they wrote.
 */
export function applyBlankSuggestion(
  body: string,
  blank: Pick<DetectedBlank, 'index' | 'raw' | 'key'>,
): string | null {
  if (typeof body !== 'string' || !blank?.key) return null;
  const { index, raw } = blank;
  if (!Number.isInteger(index) || index < 0 || typeof raw !== 'string' || !raw) return null;
  if (body.slice(index, index + raw.length) !== raw) return null;
  return `${body.slice(0, index)}{{${blank.key}}}${body.slice(index + raw.length)}`;
}

/**
 * The body with one ruled blank taken out, or null when it no longer fits.
 *
 * The counterpart of applyBlankSuggestion for a signature place, and the same
 * slice check for the same reason. Only the rule goes: "By: ______" becomes
 * "By:", which is exactly what stripExecutionRules does on the import path, so
 * a hand-typed body and an imported one end up in the same state.
 */
export function removeRuledBlank(
  body: string,
  blank: Pick<DetectedBlank, 'index' | 'raw'>,
): string | null {
  if (typeof body !== 'string') return null;
  const { index, raw } = blank ?? ({} as { index: number; raw: string });
  if (!Number.isInteger(index) || index < 0 || typeof raw !== 'string' || !raw) return null;
  if (body.slice(index, index + raw.length) !== raw) return null;
  return `${body.slice(0, index)}${body.slice(index + raw.length)}`;
}

/**
 * What a body says about being signed, over and above its ruled blanks.
 *
 * A document can carry "IN WITNESS WHEREOF" or "[Signature Page Follows]" and
 * not one underscore, and that document is still signed. Returned separately
 * from the blanks because there is nothing on the page to point at: it is a
 * reason to check the delivery mode, not a place to put a field.
 */
export function detectSignatureEvidence(body: unknown): string | null {
  return describeSignatureEvidence(typeof body === 'string' ? body : '');
}
