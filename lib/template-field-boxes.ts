/**
 * Where the counterparty's blanks are on the page, and the one arithmetic
 * both ends of the ceremony run over them.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The document is rendered once and stored, because the renderer is not
 * deterministic: its footer draws today's date and pdf-lib stamps a fresh
 * CreationDate, so a second render of identical text produces different bytes
 * and the SHA-256 in the audit chain would attest to a document nobody saw
 * (lib/submission-document.ts states this at length). So the counterparty's
 * typed values cannot reach the page by re-rendering it.
 *
 * They reach it by being drawn INTO boxes the renderer recorded at the one
 * moment it drew. lib/branded-document-pdf.ts measures each blank as it lays
 * the line out and hands the boxes back; lib/submission-document.ts stores
 * them on the submission; the live overlay in app/sign/[token]/document-view
 * and the stamp in lib/signature-render.ts both read them back through this
 * module. Preview equals delivered because both ends read one recorded
 * geometry, not because two pieces of code were written to agree.
 *
 * That is the same discipline lib/signature-geometry.ts enforces for the
 * signature box, after that geometry drifted twice across three hand-written
 * copies. This module is the fourth-copy prevention for the field blanks. Do
 * not compute a field rectangle anywhere else.
 *
 * THE MARKER
 * ----------
 * mergeTemplateDocument renders a counterparty field as counterpartyMarker(key)
 * rather than as `[Label]`, and three properties of that literal are
 * load-bearing:
 *
 *   1. It is a single whitespace-free token, so the renderer's word wrap
 *      (which only ever breaks at whitespace) can never split one blank
 *      across two lines and leave half a box behind.
 *   2. It is ASCII, therefore WinAnsi-encodable, because pdf-lib's standard
 *      fonts refuse a character WinAnsi cannot encode and the refusal is a
 *      thrown error in the middle of a render.
 *   3. It survives cleanLegalText unchanged. That function strips markdown
 *      emphasis and bracketed meta-notes, and both nearly ate this marker:
 *      `_x_` is italic (blocked here by the doubled underscore, which the
 *      emphasis rule explicitly declines with `(?!_)`), and
 *      `\[(?:note|ai|assistant)[^\]]*\]` would have silently deleted the
 *      sentinel of any field keyed `note_...`, `ai_...` or `assistant_...`
 *      had square brackets been used. They are not. Angle brackets are.
 *
 * The underscore run is five, deliberately under the six that
 * findTextSignatureAnchors treats as a signature line
 * (lib/signature-anchors.ts, `_{6,}`). That scanner cannot in fact read a
 * pdf-lib content stream at all today, which lib/firm-template-placeholders.ts
 * documents with the three independent reasons it was verified by, but a blank
 * for the other side's address is not a signature line and must not read as
 * one to whoever repairs it. The sentinel is the positive identification; the
 * short run is the belt to that braces.
 */

/**
 * The page the renderer lays out, in points. Declared here rather than in
 * lib/branded-document-pdf.ts because parseFieldBoxes has to bound a stored
 * coordinate against the page it was recorded on, and a second copy of the
 * page size is exactly the drift this module exists to prevent. The renderer
 * imports these.
 *
 * ONE PAGE SIZE, AND A BLANK THAT SAYS SO ANYWAY. Every document this renderer
 * produces is US Letter and there is no setting that changes it. The blanks
 * nonetheless record the page they were measured on, because these two constants
 * are the yardstick parseFieldBoxes bounds against, and a yardstick that is
 * implied rather than recorded is only correct until it is not. See FieldBox.
 */
export const RENDERED_PAGE_WIDTH_PT = 612;
export const RENDERED_PAGE_HEIGHT_PT = 792;

/** Underscores either side of the sentinel. See the header for why five. */
export const MARKER_UNDERSCORE_RUN = 5;

const UNDERSCORES = '_'.repeat(MARKER_UNDERSCORE_RUN);

/**
 * Every marker in a line, in the order they appear.
 *
 * Keys are already narrowed to `[a-z0-9_]` and 40 characters by
 * sanitizeFields (lib/firm-templates.ts), so this pattern accepts exactly
 * what that function can produce and nothing else. A key it could not have
 * produced is not a key, and a line that happens to contain angle brackets
 * and underscores is not a blank.
 */
const MARKER_RE = new RegExp(
  `_{${MARKER_UNDERSCORE_RUN}}<<([a-z0-9_]{1,40})>>_{${MARKER_UNDERSCORE_RUN}}`,
  'g',
);

/** The literal a counterparty blank is rendered as. */
export function counterpartyMarker(key: string): string {
  return `${UNDERSCORES}<<${key}>>${UNDERSCORES}`;
}

export type LineMarker = {
  key: string;
  /** Index of the marker's first character within the line. */
  index: number;
  /** The literal, so the caller measures exactly what it drew. */
  text: string;
};

/** Find every marker in one laid-out line. Pure, and the renderer's only
 *  route from drawn text back to a field key. */
export function findLineMarkers(line: string): LineMarker[] {
  if (typeof line !== 'string' || line === '') return [];
  const out: LineMarker[] = [];
  // A fresh RegExp per call: a module-level /g pattern carries lastIndex
  // between calls and would skip markers on alternating lines.
  const re = new RegExp(MARKER_RE.source, 'g');
  let m = re.exec(line);
  while (m) {
    out.push({ key: m[1], index: m.index, text: m[0] });
    m = re.exec(line);
  }
  return out;
}

/** True when a document carries at least one counterparty blank. */
export function hasCounterpartyMarkers(text: unknown): boolean {
  if (typeof text !== 'string' || text === '') return false;
  return new RegExp(MARKER_RE.source).test(text);
}

export type DocumentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; key: string };

/**
 * A document split into the words around its blanks and the blanks
 * themselves, so a surface can DRAW a blank instead of printing the sentinel.
 *
 * The on-screen preview and the delivered PDF have to agree, and the PDF now
 * rules the blank rather than drawing the marker
 * (drawBodyLine, lib/branded-document-pdf.ts). Without this the employee
 * filling the form and the attorney approving it read
 * `_____<<entity_name>>_____` while the recipient received a clean ruled line.
 *
 * Deliberately NOT a replace into different text. The marker has to survive
 * unchanged in document_text, because that is what the renderer measures and
 * records a box from; only the presentation changes, and only on the surfaces
 * that show the document rather than the ones that edit it.
 */
export function splitAtCounterpartyMarkers(text: string): DocumentSegment[] {
  if (typeof text !== 'string' || text === '') return [];
  const out: DocumentSegment[] = [];
  const re = new RegExp(MARKER_RE.source, 'g');
  let at = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    out.push({ kind: 'blank', key: m[1] });
    at = m.index + m[0].length;
    m = re.exec(text);
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/**
 * Whether a string is one of our blanks rather than a signature rule.
 *
 * The distinguishing feature is the sentinel and not the length of the
 * underscore run, so this is what a future reader of a document should test
 * with rather than counting underscores.
 */
export function isCounterpartyMarker(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const re = new RegExp(`^${MARKER_RE.source}$`);
  return re.test(value);
}

/**
 * How a blank is ruled, on both of the two occasions it is drawn.
 *
 * The renderer draws it when it lays the document out, and the executed copy
 * draws it again over the opaque cover it paints before stamping the typed
 * value. If either end held its own numbers, the blank the counterparty was
 * shown and the blank on the instrument they signed would be two different
 * lines, which is the drift lib/signature-geometry.ts exists because of. Both
 * read this.
 *
 * The offset lifts the rule off the box floor by a point so a value sat at
 * `y + 4` sits ON the rule rather than through it.
 */
export const FIELD_RULE = {
  offsetYPt: 1,
  thicknessPt: 0.5,
  /** Mid grey: legibly a blank, quieter than the body text above it. */
  gray: 0.45,
} as const;

export type FieldBox = {
  key: string;
  /** 1-indexed page the blank was drawn on. */
  page: number;
  /** Left edge, in points from the page's left edge. */
  x: number;
  /** BOTTOM edge, in points up from the page's bottom edge. PDF-native, the
   *  same convention firm_signatures.position_y uses. */
  y: number;
  widthPt: number;
  heightPt: number;
  /**
   * The page this blank was recorded on, in points.
   *
   * Recorded because the coordinate above is meaningless without it. A blank at
   * x = 700 is legitimate on a landscape sheet and corrupt on a portrait one, and
   * parseFieldBoxes cannot tell which without being told.
   *
   * OPTIONAL, AND ABSENT IS NOT MISSING. Every row written before the renderer
   * started recording this was US Letter, so a row with no page size gets the
   * Letter constants and is correct. Inventing a size for those rows would make
   * them indistinguishable from rows the renderer actually measured.
   *
   * WHY RECORD IT WHILE THERE IS ONLY ONE PAGE SIZE. Because it is free exactly
   * now and never again: firm_template_submissions.field_boxes has 0 populated
   * rows in production, so there is no backfill to do and no legacy row to
   * misread. It is written as hardening rather than to serve a feature.
   */
  pageWidthPt?: number;
  pageHeightPt?: number;
};

/**
 * How wide the fill area for one blank is.
 *
 * The marker itself is only about two inches at 11pt, which is short for an
 * entity name, so a blank that ends its line takes the rest of the measure.
 * A blank with words after it takes its own width plus whatever spaces the
 * template put after it, and no more: the executed copy covers this box with
 * an opaque rectangle before drawing into it, so a box wider than the blank
 * would erase the words beside it.
 *
 * Pure arithmetic over widths the renderer's layout loop already holds, so it
 * is testable without pdf-lib.
 */
export function resolveMarkerBoxWidth(input: {
  /** Measured width of the marker literal, in points. */
  markerWidthPt: number;
  /** Measured width of the spaces immediately following it, in points. */
  trailingSpaceWidthPt: number;
  /** The marker's left edge, in points from the left margin. */
  xFromMarginPt: number;
  /** Width of the text measure, in points. */
  contentWidthPt: number;
  /** True when nothing but spaces follows the marker on this line. */
  endsLine: boolean;
}): number {
  const marker = positive(input.markerWidthPt);
  const trailing = Math.max(0, finiteOr(input.trailingSpaceWidthPt, 0));
  const measure = positive(input.contentWidthPt);
  const from = Math.max(0, finiteOr(input.xFromMarginPt, 0));
  // Never past the right margin, whichever branch. A blank that runs into the
  // margin would be covered by a rectangle that runs into the margin.
  const room = Math.max(marker, measure - from);
  if (input.endsLine) return room;
  return Math.min(marker + trailing, room);
}

/**
 * The size the typed value is drawn at so it fits its blank.
 *
 * Times widths scale linearly with the point size, so the fitted size is one
 * division rather than a search. It floors rather than shrinking without
 * limit: a value squeezed to four points is not legible, and an executed
 * instrument nobody can read is worse than one where a long entity name runs
 * a little wide. The overflow is reported to the caller so it can be admitted
 * on the audit trail rather than absorbed.
 */
export const FIELD_TEXT_MIN_SIZE_PT = 7;

export function resolveFieldTextSize(input: {
  /** Width of the value measured at `baseSizePt`. */
  naturalWidthPt: number;
  boxWidthPt: number;
  baseSizePt: number;
  minSizePt?: number;
}): { sizePt: number; shrunk: boolean; overflows: boolean } {
  const base = positive(input.baseSizePt);
  const min = Math.min(base, positive(input.minSizePt ?? FIELD_TEXT_MIN_SIZE_PT));
  const natural = finiteOr(input.naturalWidthPt, 0);
  const box = positive(input.boxWidthPt);
  if (natural <= 0) return { sizePt: base, shrunk: false, overflows: false };
  if (natural <= box) return { sizePt: base, shrunk: false, overflows: false };
  const wanted = (base * box) / natural;
  const sizePt = Math.max(min, wanted);
  return {
    sizePt,
    shrunk: sizePt < base,
    // True only when even the floor is too small, which is the case the
    // caller has to admit rather than hide.
    overflows: wanted < min,
  };
}

export type FieldBoxRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  requestedX: number;
  requestedY: number;
  dxPt: number;
  dyPt: number;
  relocated: boolean;
  shrunk: boolean;
};

/**
 * Put one recorded blank onto a real page.
 *
 * THIS IS THE FUNCTION THAT MAKES PREVIEW EQUAL DELIVERED. The live overlay
 * calls it and converts the result to CSS fractions; lib/signature-render.ts
 * calls it and draws into the result. Neither computes a rectangle of its
 * own. A change here moves both, which is the property being bought.
 *
 * The clamp exists for the same reason computeSignatureBoxRect's does: the
 * recorded coordinate is bounded, but the BOX that starts at it is not, and
 * pdf-lib silently drops whatever falls off the edge. A page that is not a
 * page collapses the rectangle to nothing rather than producing NaN
 * coordinates, and the callers skip a zero-width rectangle.
 */
export function resolveFieldBoxRect(
  box: FieldBox,
  page: { pageWidthPt: number; pageHeightPt: number },
): FieldBoxRect {
  const pw = page.pageWidthPt;
  const ph = page.pageHeightPt;
  const empty: FieldBoxRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    requestedX: 0,
    requestedY: 0,
    dxPt: 0,
    dyPt: 0,
    relocated: false,
    shrunk: true,
  };
  if (!isFinite(pw) || !isFinite(ph) || pw <= 0 || ph <= 0) return empty;
  if (!isFinite(box?.widthPt) || !isFinite(box?.heightPt)) return empty;
  if (box.widthPt <= 0 || box.heightPt <= 0) return empty;

  const width = Math.min(box.widthPt, pw);
  const height = Math.min(box.heightPt, ph);
  const requestedX = finiteOr(box.x, 0);
  const requestedY = finiteOr(box.y, 0);
  const x = clamp(requestedX, 0, pw - width);
  const y = clamp(requestedY, 0, ph - height);
  return {
    x,
    y,
    width,
    height,
    requestedX,
    requestedY,
    dxPt: x - requestedX,
    dyPt: y - requestedY,
    relocated: x !== requestedX || y !== requestedY,
    shrunk: width < box.widthPt || height < box.heightPt,
  };
}

/** A box on a page as fractions of it, CSS orientation (origin top-left). */
export type FieldRectFractions = {
  leftFrac: number;
  topFrac: number;
  widthFrac: number;
  heightFrac: number;
};

/**
 * The same rectangle, in the coordinates a browser positions in.
 *
 * The only difference between what the overlay draws and what the stamp draws
 * is this conversion: PDF y is the bottom edge measured up, CSS top is the
 * top edge measured down. Everything before it is resolveFieldBoxRect, shared.
 * The caller then runs rotateSignatureRectForDisplay over the result if the
 * page carries a /Rotate, exactly as it already does for the signature box.
 */
export function fieldRectToDisplayFractions(
  rect: FieldBoxRect,
  page: { pageWidthPt: number; pageHeightPt: number },
): FieldRectFractions {
  const pw = page.pageWidthPt;
  const ph = page.pageHeightPt;
  if (!isFinite(pw) || !isFinite(ph) || pw <= 0 || ph <= 0) {
    return { leftFrac: 0, topFrac: 0, widthFrac: 0, heightFrac: 0 };
  }
  return {
    leftFrac: rect.x / pw,
    topFrac: 1 - (rect.y + rect.height) / ph,
    widthFrac: rect.width / pw,
    heightFrac: rect.height / ph,
  };
}

/**
 * Every place one field is blank on the document.
 *
 * Plural on purpose. A template may legitimately name the same placeholder
 * more than once ("this Agreement is between {{entity_name}} ... signed for
 * {{entity_name}}"), and filling only the first would leave the second
 * showing a raw marker on the executed instrument. Both the overlay and the
 * stamp iterate this, so one typed value lands in every blank it belongs in.
 */
export function boxesForKey(
  boxes: readonly FieldBox[] | null | undefined,
  key: string,
): FieldBox[] {
  if (!Array.isArray(boxes)) return [];
  return boxes.filter((b) => b.key === key);
}

/** The first blank for a key, or null when the document has none. Use this
 *  to ask whether a field has a place at all, not to draw into. */
export function boxForKey(
  boxes: readonly FieldBox[] | null | undefined,
  key: string,
): FieldBox | null {
  return boxesForKey(boxes, key)[0] ?? null;
}

/** The distinct field keys the document actually has blanks for.
 *
 *  This is the authorization set for what a counterparty may write: a key
 *  with no blank on the approved document has nowhere to go, so accepting a
 *  value for it would record a fact the instrument does not carry. */
export function fieldBoxKeys(boxes: readonly FieldBox[]): string[] {
  const out: string[] = [];
  for (const b of boxes) if (!out.includes(b.key)) out.push(b.key);
  return out;
}

/**
 * Read boxes back across the jsonb boundary.
 *
 * Everything on the far side of that boundary is untrusted in the sense that
 * matters here: it is whatever the column happens to hold, including whatever
 * an older or newer version of the renderer wrote. An unvalidated read is how
 * geometry drifts and how a NaN coordinate reaches pdf-lib, so a malformed
 * entry is DROPPED rather than repaired into something plausible and never
 * throws, because a signing page that will not render is a worse failure than
 * a blank that is not offered.
 *
 * Coordinates are bounded to the page the blank was recorded on, which the blank
 * now carries. That is a real bound and not a formality: a coordinate outside its
 * own page is corrupt by definition.
 *
 * IT USED TO BE BOUNDED TO THIS MODULE'S LETTER CONSTANT UNCONDITIONALLY, which is
 * right for exactly as long as every document is Letter, and every document is
 * Letter today. This is hardening against the day one is not: the instant a second
 * page size exists, an unqualified clamp stops bounding corruption and starts
 * MOVING valid geometry, and a blank recorded at x = 700 on a landscape sheet comes
 * back at 612, 88 points to the left, on the page the counterparty types into and
 * on the executed instrument, with nothing thrown and nothing logged. The bound was
 * never wrong, the yardstick was implied. A blank that does not name its page still
 * gets the Letter constants, because that is the page every such row was rendered
 * on.
 */
export function parseFieldBoxes(raw: unknown): FieldBox[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldBox[] = [];
  for (const entry of raw.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key : '';
    // Repeats are kept, not deduplicated. The same placeholder can appear
    // twice in one instrument and both blanks have to be filled. See
    // boxesForKey.
    if (!/^[a-z0-9_]{1,40}$/.test(key)) continue;
    const page = num(o.page);
    const x = num(o.x);
    const y = num(o.y);
    const widthPt = num(o.widthPt);
    const heightPt = num(o.heightPt);
    if (page === null || x === null || y === null || widthPt === null || heightPt === null) {
      continue;
    }
    if (page < 1 || widthPt <= 0 || heightPt <= 0) continue;
    // A page size that is not a page is DROPPED rather than repaired, exactly as
    // a malformed coordinate is, and the box then falls back to the Letter
    // default. Bounding against a stored 0 or a stored "wide" would collapse
    // every blank on the document to the left edge.
    const pageWidthPt = pagePt(o.pageWidthPt);
    const pageHeightPt = pagePt(o.pageHeightPt);
    const boundW = pageWidthPt ?? RENDERED_PAGE_WIDTH_PT;
    const boundH = pageHeightPt ?? RENDERED_PAGE_HEIGHT_PT;
    const box: FieldBox = {
      key,
      page: Math.floor(page),
      x: clamp(x, 0, boundW),
      y: clamp(y, 0, boundH),
      widthPt: clamp(widthPt, 0, boundW),
      heightPt: clamp(heightPt, 0, boundH),
    };
    // Assigned only when present, so a legacy box parses back EQUAL to itself
    // rather than gaining two undefined keys that a deep comparison would see.
    if (pageWidthPt !== null) box.pageWidthPt = pageWidthPt;
    if (pageHeightPt !== null) box.pageHeightPt = pageHeightPt;
    out.push(box);
  }
  return out;
}

/**
 * The jsonb form. Coordinates are rounded to hundredths of a point, which is
 * finer than any printer resolves and keeps the stored value from carrying a
 * float's last few meaningless digits into a column a human may read.
 */
export function serializeFieldBoxes(boxes: readonly FieldBox[]): unknown {
  return boxes.map((b) => {
    const out: Record<string, unknown> = {
      key: b.key,
      page: Math.floor(b.page),
      x: round2(b.x),
      y: round2(b.y),
      widthPt: round2(b.widthPt),
      heightPt: round2(b.heightPt),
    };
    // Written only when the caller measured one. An unconditional pair would
    // stamp the Letter default onto rows nobody measured, which is the guess this
    // column must not carry.
    const pw = pagePt(b.pageWidthPt);
    const ph = pagePt(b.pageHeightPt);
    if (pw !== null) out.pageWidthPt = round2(pw);
    if (ph !== null) out.pageHeightPt = round2(ph);
    return out;
  });
}

/** A page dimension out of the jsonb, or null. Zero and NaN are not pages. */
function pagePt(n: unknown): number | null {
  return isFinite(n) && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function finiteOr(n: unknown, fallback: number): number {
  return isFinite(n) ? n : fallback;
}

function positive(n: unknown): number {
  return isFinite(n) && n > 0 ? n : 0;
}

function num(n: unknown): number | null {
  return isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
