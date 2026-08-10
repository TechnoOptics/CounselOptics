/**
 * WHERE the letterhead, the watermark and the footer sit on a rendered page.
 *
 * A firm could already say WHAT its letterhead is, twice over: an uploaded
 * image on firms.letterhead_url, or a design typed into the app and laid out by
 * letterheadDesignLines (lib/letterhead-design.ts). What it could not say is
 * where any of it goes, and it had no watermark at all. This module is the
 * second half: position, page rule, and the state rule that makes a DRAFT mark
 * stop once a document is signed. It decides nothing about what the letterhead
 * SAYS; that stays where it is.
 *
 * THIS MODULE IS PURE ON PURPOSE, AND HAS NO IMPORTS
 * --------------------------------------------------
 * No `server-only`, no React, nothing from the rest of lib. The builder preview
 * is a client component and the renderer is a server module, and both need the
 * identical answer to "where does this rectangle go?". Laying it out twice is
 * how a preview starts lying about the document, which is the defect
 * lib/signature-geometry.ts exists because of, after the same arithmetic was
 * written three times and drifted twice in opposite directions. So the
 * arithmetic is here, once, and both ends call it. Do not compute a rectangle
 * anywhere else.
 *
 * THE PAGE IS AN ARGUMENT, NOT A CONSTANT. Every function takes the page size
 * rather than declaring one, because lib/template-field-boxes.ts already owns
 * RENDERED_PAGE_WIDTH_PT and RENDERED_PAGE_HEIGHT_PT and a second copy of the
 * page size is exactly the drift that module exists to prevent. The zero-import
 * rule and the one-page-size rule would otherwise be in conflict; passing it in
 * satisfies both.
 *
 * WHAT THIS CANNOT DO, AND MUST NOT
 * ---------------------------------
 * It cannot move a document that has already been rendered. A document's bytes
 * are stored at first render and the geometry of every counterparty blank is
 * recorded in the same moment (lib/submission-document.ts). The live signing
 * overlay and the stamp on the executed copy both read those recorded
 * coordinates. A layout is therefore an INPUT to a render: it changes what the
 * next document looks like and can never reach a document already out for
 * signature, because nothing re-renders one.
 *
 * That safety rests on the defaults below being the numbers the renderer
 * already used. A firm that never opens the builder must get the document it
 * got last week, to the point.
 */

/**
 * Where a document is in its life, as far as a watermark is concerned.
 *
 * Three states, because these are the three a rendered document is actually
 * produced in and no more:
 *
 *   unsigned  Nobody has signed it. The legal team's own draft in the template
 *             and letter studios, and an employee's preview of a form they have
 *             not signed.
 *   signed    A mark is on the document. This includes the instrument filed by
 *             lib/submission-document.ts, which is deliberately rendered in
 *             this state: those exact bytes become the executed copy, a
 *             watermark drawn into them could never be removed, and the owner's
 *             rule is that the mark stops once the document is signed.
 *   copy      A copy delivered to somebody after the fact. The encrypted share
 *             an outside recipient downloads (lib/template-release.ts).
 */
export type DocumentState = 'unsigned' | 'signed' | 'copy';

export const DOCUMENT_STATES: readonly DocumentState[] = ['unsigned', 'signed', 'copy'];

/** Which pages a band appears on. */
export type PageRule = 'first' | 'all' | 'all_except_first';

export const PAGE_RULES: readonly PageRule[] = ['first', 'all', 'all_except_first'];

export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAnchor = 'top' | 'middle' | 'bottom';

/** What the watermark is made of. `logo` draws the firm's own logo image. */
export type WatermarkSource = 'text' | 'logo';

/** The page a layout is resolved against, in points. */
export type PageSize = { widthPt: number; heightPt: number };

export type DocumentMargins = {
  topPt: number;
  rightPt: number;
  bottomPt: number;
  leftPt: number;
};

export type LetterheadPlacement = {
  show: boolean;
  pages: PageRule;
  /** How far below the top edge of the page the band begins, in points. */
  topPt: number;
};

export type WatermarkPlacement = {
  show: boolean;
  source: WatermarkSource;
  /**
   * What it says, per document state. Empty is not a blank watermark, it is no
   * watermark, so a firm can say DRAFT on an unsigned page and COPY on a
   * delivered one without a second switch.
   */
  text: Record<DocumentState, string>;
  /** The states it appears in at all. Empty silences it everywhere. */
  states: DocumentState[];
  opacity: number;
  rotationDeg: number;
  sizePt: number;
  align: HorizontalAlign;
  anchor: VerticalAnchor;
  pages: PageRule;
};

export type FooterPlacement = {
  show: boolean;
  pages: PageRule;
  align: HorizontalAlign;
  /** The baseline, in points up from the bottom edge of the page. */
  baselinePt: number;
  /** Fixed firm text. Empty falls back to the firm name. */
  text: string;
  pageNumbers: boolean;
  generatedDate: boolean;
  sizePt: number;
};

export type DocumentLayout = {
  margins: DocumentMargins;
  letterhead: LetterheadPlacement;
  watermark: WatermarkPlacement;
  footer: FooterPlacement;
};

/**
 * The key inside firms.metadata, following the letterhead design precedent so
 * this half needs no migration. Named once so the action that writes it and the
 * renderer that reads it cannot drift onto two spellings.
 */
export const DOCUMENT_LAYOUT_METADATA_KEY = 'document_layout';

/**
 * Bounds. Every one of these is a real limit rather than a formality: the value
 * on the far side of the jsonb boundary is whatever some other writer put
 * there, and an opacity of 4 or a margin of 900 points reaching pdf-lib is a
 * document with its body off the page.
 *
 * The margin ceiling is a quarter of the short side of a Letter page, three
 * inches, which still leaves a two and a half inch measure. The floor is a
 * quarter inch, under which a laser printer clips.
 */
const MARGIN_MIN_PT = 18;
const MARGIN_MAX_PT = 216;
const LETTERHEAD_TOP_MAX_PT = 240;
const FOOTER_BASELINE_MIN_PT = 8;
const FOOTER_BASELINE_MAX_PT = 144;
const FOOTER_SIZE_MIN_PT = 6;
const FOOTER_SIZE_MAX_PT = 14;
const WATERMARK_OPACITY_MIN = 0.02;
/**
 * A watermark is behind the body text, and past this it competes with the words
 * rather than sitting under them. It is also the ceiling that stops a stored
 * value of 1 from painting a solid block over an instrument.
 */
const WATERMARK_OPACITY_MAX = 0.6;
const WATERMARK_ROTATION_MAX_DEG = 90;
const WATERMARK_SIZE_MIN_PT = 8;
const WATERMARK_SIZE_MAX_PT = 144;
const WATERMARK_TEXT_MAX = 40;
const FOOTER_TEXT_MAX = 120;

/** What sits between the parts of the footer line. Matches the letterhead
 *  contact separator, so the two bands of one document read alike. */
const FOOTER_SEPARATOR = '  -  ';

/**
 * The layout the renderer already had, before any of it was configurable.
 *
 * These are not preferences. 64 points either side, a body floor at 60, a
 * footer baseline at 36, a letterhead band flush to the top of every page and
 * no watermark at all are what lib/branded-document-pdf.ts drew, and the
 * counterparty blanks recorded on every document already out for signature were
 * measured against them. A firm that never opens the builder gets the same
 * document, to the point.
 */
export const DEFAULT_DOCUMENT_LAYOUT: DocumentLayout = {
  margins: { topPt: 64, rightPt: 64, bottomPt: 60, leftPt: 64 },
  letterhead: { show: true, pages: 'all', topPt: 0 },
  watermark: {
    // Off. Turning it on by default would stamp DRAFT across the next document
    // every firm sends without anybody having asked for it.
    show: false,
    source: 'text',
    // The owner's rule, ready for the moment it is switched on: DRAFT while
    // unsigned, nothing once signed.
    text: { unsigned: 'DRAFT', signed: '', copy: '' },
    states: ['unsigned'],
    opacity: 0.08,
    rotationDeg: 45,
    sizePt: 90,
    align: 'center',
    anchor: 'middle',
    pages: 'all',
  },
  footer: {
    show: true,
    pages: 'all',
    align: 'left',
    baselinePt: 36,
    text: '',
    pageNumbers: true,
    generatedDate: true,
    sizePt: 8,
  },
};

/**
 * Read the layout key out of the firm's shared metadata bag, WITHOUT
 * normalizing it.
 *
 * Raw on purpose. resolveDocumentLayout merges the firm value with a partial
 * template override and normalizes the result once; normalizing the firm half
 * first would fill in every default, and a template override could then never
 * be told apart from a firm setting.
 */
export function firmDocumentLayoutInput(metadata: unknown): unknown {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[DOCUMENT_LAYOUT_METADATA_KEY];
  return value === undefined ? null : value;
}

/**
 * The trust boundary over the jsonb.
 *
 * Always returns a usable layout, never null: there is no such thing as a
 * document with no layout, so the honest answer to "this stored value is not a
 * layout" is the default one rather than a refusal the renderer would have to
 * handle.
 *
 * Non-numbers are NOT coerced. A stored "90" is not a margin, it is a value
 * some other writer put in a shared bag, and String-to-Number here is this
 * boundary guessing. The same reasoning lib/letterhead-design.ts settled for
 * its text fields.
 */
export function normalizeDocumentLayout(input: unknown): DocumentLayout {
  const raw = asObject(input);
  const margins = asObject(raw.margins);
  const letterhead = asObject(raw.letterhead);
  const watermark = asObject(raw.watermark);
  const footer = asObject(raw.footer);
  const watermarkText = asObject(watermark.text);
  const d = DEFAULT_DOCUMENT_LAYOUT;

  return {
    margins: {
      topPt: clampNumber(margins.topPt, MARGIN_MIN_PT, MARGIN_MAX_PT, d.margins.topPt),
      rightPt: clampNumber(margins.rightPt, MARGIN_MIN_PT, MARGIN_MAX_PT, d.margins.rightPt),
      bottomPt: clampNumber(margins.bottomPt, MARGIN_MIN_PT, MARGIN_MAX_PT, d.margins.bottomPt),
      leftPt: clampNumber(margins.leftPt, MARGIN_MIN_PT, MARGIN_MAX_PT, d.margins.leftPt),
    },
    letterhead: {
      show: asBoolean(letterhead.show, d.letterhead.show),
      pages: asPageRule(letterhead.pages, d.letterhead.pages),
      topPt: clampNumber(letterhead.topPt, 0, LETTERHEAD_TOP_MAX_PT, d.letterhead.topPt),
    },
    watermark: {
      show: asBoolean(watermark.show, d.watermark.show),
      source: watermark.source === 'logo' ? 'logo' : 'text',
      text: {
        unsigned: asText(watermarkText.unsigned, WATERMARK_TEXT_MAX, d.watermark.text.unsigned),
        signed: asText(watermarkText.signed, WATERMARK_TEXT_MAX, d.watermark.text.signed),
        copy: asText(watermarkText.copy, WATERMARK_TEXT_MAX, d.watermark.text.copy),
      },
      states: asStates(watermark.states, d.watermark.states),
      opacity: clampNumber(
        watermark.opacity,
        WATERMARK_OPACITY_MIN,
        WATERMARK_OPACITY_MAX,
        d.watermark.opacity,
      ),
      rotationDeg: clampNumber(
        watermark.rotationDeg,
        -WATERMARK_ROTATION_MAX_DEG,
        WATERMARK_ROTATION_MAX_DEG,
        d.watermark.rotationDeg,
      ),
      sizePt: clampNumber(
        watermark.sizePt,
        WATERMARK_SIZE_MIN_PT,
        WATERMARK_SIZE_MAX_PT,
        d.watermark.sizePt,
      ),
      align: asAlign(watermark.align, d.watermark.align),
      anchor: asAnchor(watermark.anchor, d.watermark.anchor),
      pages: asPageRule(watermark.pages, d.watermark.pages),
    },
    footer: {
      show: asBoolean(footer.show, d.footer.show),
      pages: asPageRule(footer.pages, d.footer.pages),
      align: asAlign(footer.align, d.footer.align),
      baselinePt: clampNumber(
        footer.baselinePt,
        FOOTER_BASELINE_MIN_PT,
        FOOTER_BASELINE_MAX_PT,
        d.footer.baselinePt,
      ),
      text: asText(footer.text, FOOTER_TEXT_MAX, d.footer.text),
      pageNumbers: asBoolean(footer.pageNumbers, d.footer.pageNumbers),
      generatedDate: asBoolean(footer.generatedDate, d.footer.generatedDate),
      sizePt: clampNumber(footer.sizePt, FOOTER_SIZE_MIN_PT, FOOTER_SIZE_MAX_PT, d.footer.sizePt),
    },
  };
}

/**
 * The precedence the owner chose: per firm, with a per-template override.
 *
 * THE OVERRIDE IS PARTIAL. A template that sets only the watermark inherits the
 * firm's margins, letterhead and footer, so the two are merged key by key
 * BEFORE either is normalized. Normalizing the halves separately would fill the
 * template's three unset bands with product defaults and quietly discard
 * everything the firm had configured.
 *
 * A TEMPLATE CAN SWITCH A BAND OFF. `show` is an ordinary field, so an override
 * that sets it false wins over a firm that set it true, and an empty
 * `watermark.states` silences the mark. The alternative, an override that can
 * only add and never remove, was considered and rejected: it would leave a firm
 * unable to have one template without the footer, and there is no other way to
 * express "off" that an additive merge would honour. Pinned by a test.
 *
 * Arrays are replaced, not merged. `states: ['copy']` on a template means those
 * states and no others; element-wise merging would make a shorter list
 * impossible to express.
 */
export function resolveDocumentLayout(
  firmDefault: unknown,
  templateOverride: unknown,
): DocumentLayout {
  return normalizeDocumentLayout(mergeLayoutInput(firmDefault, templateOverride));
}

/** The four bands, named once so the merge and the sanitizer agree. */
const LAYOUT_BANDS = ['margins', 'letterhead', 'watermark', 'footer'] as const;

/**
 * What a template override is allowed to be, before it is written.
 *
 * The trust boundary on the WRITE side of firm_templates.document_layout, and
 * the reason it exists is that the override has to stay PARTIAL. Storing a band
 * in full, with the fields the author never touched filled in from the firm's
 * current settings, would freeze those settings into the template on the day it
 * was saved: the firm would change its margins later and this one template
 * would quietly keep the old ones with nothing on screen to say why.
 *
 * So only the keys actually present survive, and each one is passed through
 * normalizeDocumentLayout to be clamped. A band with nothing recognisable left
 * in it is dropped, and an override with no bands left is null, which is the
 * same value as "this template does not override the firm".
 */
export function sanitizeDocumentLayoutOverride(
  input: unknown,
): Record<string, unknown> | null {
  if (!isPlainObject(input)) return null;
  const out: Record<string, unknown> = {};
  for (const band of LAYOUT_BANDS) {
    const raw = input[band];
    if (!isPlainObject(raw)) continue;
    // Normalized as a whole layout so every value is clamped by the one
    // boundary, then narrowed back to the keys the author actually set.
    const normalized = normalizeDocumentLayout({ [band]: raw }) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    const kept: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      if (key in normalized[band]) kept[key] = normalized[band][key];
    }
    if (Object.keys(kept).length > 0) out[band] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Two levels deep, which is exactly as deep as a layout goes: the four bands,
 *  and the fields inside each. */
function mergeLayoutInput(base: unknown, override: unknown): unknown {
  const b = asObject(base);
  const o = asObject(override);
  const out: Record<string, unknown> = { ...b };
  for (const [key, value] of Object.entries(o)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = { ...existing, ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** What the watermark is for one state, or nothing at all. */
export type ResolvedWatermark = {
  source: WatermarkSource;
  /** Empty when the source is the logo. */
  text: string;
  opacity: number;
  rotationDeg: number;
  sizePt: number;
  pages: PageRule;
};

/**
 * The state rule. This is the function that makes a DRAFT mark stop.
 *
 * Null means no watermark, and the three ways to get it are all deliberate: the
 * band is switched off, the state is not on the list, or the state is on the
 * list with nothing to say. The last one matters because a listed state with an
 * empty string is a control with nothing behind it, and drawing an empty run at
 * eight percent opacity is not a watermark.
 */
export function resolveWatermark(
  layout: DocumentLayout,
  state: DocumentState,
): ResolvedWatermark | null {
  const w = layout.watermark;
  if (!w.show) return null;
  if (!w.states.includes(state)) return null;
  const text = w.source === 'text' ? w.text[state] ?? '' : '';
  if (w.source === 'text' && text === '') return null;
  return {
    source: w.source,
    text,
    opacity: w.opacity,
    rotationDeg: w.rotationDeg,
    sizePt: w.sizePt,
    pages: w.pages,
  };
}

/** Whether a band appears on a given 1-indexed page. */
export function bandAppearsOnPage(rule: PageRule, pageNo: number): boolean {
  if (!isFiniteNumber(pageNo) || pageNo < 1) return false;
  if (rule === 'all') return true;
  if (rule === 'first') return pageNo === 1;
  return pageNo > 1;
}

/** The measure, in PDF coordinates: y measured up from the bottom edge. */
export type ContentBox = {
  /** Left edge. */
  xPt: number;
  /** Right edge. */
  rightXPt: number;
  widthPt: number;
  /** Top edge, measured up from the bottom of the page. */
  topYPt: number;
  /** The floor the body stops at, measured up from the bottom of the page. */
  bottomYPt: number;
};

/**
 * The one place the measure is computed.
 *
 * The renderer's word wrap divides by this width and its page break compares
 * against this floor, so a zero or negative measure is not a cosmetic problem:
 * it is a loop that never terminates. The clamps below are what stop a narrow
 * page from producing one. A page that is not a page collapses to nothing
 * rather than producing NaN, the same way resolveFieldBoxRect does.
 */
export function resolveContentBox(layout: DocumentLayout, page: PageSize): ContentBox {
  const pw = isFiniteNumber(page?.widthPt) && page.widthPt > 0 ? page.widthPt : 0;
  const ph = isFiniteNumber(page?.heightPt) && page.heightPt > 0 ? page.heightPt : 0;
  if (pw === 0 || ph === 0) {
    return { xPt: 0, rightXPt: 0, widthPt: 0, topYPt: 0, bottomYPt: 0 };
  }
  const m = layout.margins;
  // A tenth of the page either way is the least a measure can be and still be
  // a measure. Sides are shrunk in proportion so a lopsided pair stays lopsided.
  const sides = fitPair(m.leftPt, m.rightPt, pw, pw * 0.1);
  const ends = fitPair(m.topPt, m.bottomPt, ph, ph * 0.1);
  const xPt = sides.first;
  const rightXPt = pw - sides.second;
  return {
    xPt,
    rightXPt,
    widthPt: rightXPt - xPt,
    topYPt: ph - ends.first,
    bottomYPt: ends.second,
  };
}

/** The y of the top edge of the letterhead band, measured up from the bottom
 *  of the page. Every offset inside the band is taken from here. */
export function resolveLetterheadBandTop(layout: DocumentLayout, page: PageSize): number {
  const ph = isFiniteNumber(page?.heightPt) && page.heightPt > 0 ? page.heightPt : 0;
  return ph - Math.min(layout.letterhead.topPt, ph);
}

export type WatermarkPlacementResult = {
  /** The pdf-lib draw anchor: the baseline start of the run, about which
   *  pdf-lib rotates. */
  xPt: number;
  yPt: number;
  rotationDeg: number;
  opacity: number;
};

/**
 * Where to anchor the watermark so its rotated bounding box lands where the
 * firm asked.
 *
 * pdf-lib rotates a text run about the anchor it is drawn at, not about the
 * run's own centre, so the anchor for a turned mark is not the anchor for an
 * upright one. Getting that wrong does not throw: it slides the watermark off
 * the corner of the page, which is exactly the kind of defect a green test
 * suite misses and one look at a rendered page shows.
 *
 * The mark is measured by the caller, because only the caller has the font. The
 * arithmetic over that measurement is here.
 */
export function resolveWatermarkPlacement(input: {
  layout: DocumentLayout;
  page: PageSize;
  /** Width of the mark before rotation, in points. */
  markWidthPt: number;
  /** Height of the mark before rotation, in points. */
  markHeightPt: number;
}): WatermarkPlacementResult {
  const { layout, page } = input;
  const w = Math.max(0, finiteOr(input.markWidthPt, 0));
  const h = Math.max(0, finiteOr(input.markHeightPt, 0));
  const box = resolveContentBox(layout, page);
  const theta = (layout.watermark.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // The rotated bounding box of an upright w by h rectangle.
  const boxW = Math.abs(w * cos) + Math.abs(h * sin);
  const boxH = Math.abs(w * sin) + Math.abs(h * cos);

  const centreX =
    layout.watermark.align === 'left'
      ? box.xPt + boxW / 2
      : layout.watermark.align === 'right'
        ? box.rightXPt - boxW / 2
        : (box.xPt + box.rightXPt) / 2;
  const centreY =
    layout.watermark.anchor === 'top'
      ? box.topYPt - boxH / 2
      : layout.watermark.anchor === 'bottom'
        ? box.bottomYPt + boxH / 2
        : (box.topYPt + box.bottomYPt) / 2;

  // The centre of the unrotated run, relative to its anchor, turned by the
  // same angle. Subtracting it puts the run's centre on the target centre.
  const offsetX = (w / 2) * cos - (h / 2) * sin;
  const offsetY = (w / 2) * sin + (h / 2) * cos;

  return {
    xPt: centreX - offsetX,
    yPt: centreY - offsetY,
    rotationDeg: layout.watermark.rotationDeg,
    opacity: layout.watermark.opacity,
  };
}

export type FooterPlacementResult = { xPt: number; yPt: number };

/** Where the footer line starts, given how wide the caller measured it. */
export function resolveFooterPlacement(input: {
  layout: DocumentLayout;
  page: PageSize;
  textWidthPt: number;
}): FooterPlacementResult {
  const box = resolveContentBox(input.layout, input.page);
  const width = Math.max(0, finiteOr(input.textWidthPt, 0));
  const align = input.layout.footer.align;
  const raw =
    align === 'center'
      ? box.xPt + (box.widthPt - width) / 2
      : align === 'right'
        ? box.rightXPt - width
        : box.xPt;
  // Never left of the margin. A footer wider than the measure would otherwise
  // start off the page and pdf-lib would silently drop the part that fell off.
  return { xPt: Math.max(box.xPt, raw), yPt: input.layout.footer.baselinePt };
}

/**
 * The footer line, composed once so the builder preview and the PDF cannot
 * disagree about what it says.
 *
 * Empty parts produce no separator rather than a dangling one. That is the
 * defect the letterhead contact line was fixed for: a firm whose website field
 * was empty got "phone  -  email  -", a separator pointing at nothing.
 *
 * The caller sanitizes the result for WinAnsi. This module cannot, because
 * isWinAnsiEncodable lives in lib/counterparty-fields.ts and this module has no
 * imports; and it should not, because the builder wants to WARN about a
 * character the renderer will drop rather than silently drop it too.
 */
export function composeFooterText(input: {
  layout: DocumentLayout;
  brandName: string;
  pageNo: number;
  /** Already formatted by the caller, because a date format is a locale
   *  decision and this module has no locale. */
  generatedOn: string;
}): string {
  const f = input.layout.footer;
  const lead = f.text.trim() || String(input.brandName ?? '').trim();
  const parts = [
    lead,
    f.generatedDate && input.generatedOn ? `Generated ${input.generatedOn}` : '',
    f.pageNumbers ? `Page ${Math.max(1, Math.floor(finiteOr(input.pageNo, 1)))}` : '',
  ].filter((part) => part !== '');
  return parts.join(FOOTER_SEPARATOR);
}

/* ------------------------------------------------------------------------ */

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function finiteOr(n: unknown, fallback: number): number {
  return isFiniteNumber(n) ? n : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function asPageRule(value: unknown, fallback: PageRule): PageRule {
  return value === 'first' || value === 'all' || value === 'all_except_first' ? value : fallback;
}

function asAlign(value: unknown, fallback: HorizontalAlign): HorizontalAlign {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback;
}

function asAnchor(value: unknown, fallback: VerticalAnchor): VerticalAnchor {
  return value === 'top' || value === 'middle' || value === 'bottom' ? value : fallback;
}

/**
 * Clean, collapse, trim and cap one stored string, the same way
 * lib/letterhead-design.ts does and for the same reason: the PDF draws each
 * line with a single drawText, where a newline does not break the line but
 * simply vanishes, while an HTML preview collapses it to a space. Cleaned once,
 * both surfaces read the same string.
 */
function asText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Zero-width marks and the bidi overrides, which reorder what a reader sees
 *  without changing what the string contains. */
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
/** C0 and C1 controls, including newline, carriage return and tab. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

function asStates(value: unknown, fallback: DocumentState[]): DocumentState[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: DocumentState[] = [];
  // Emitted in the canonical order rather than the stored one, so two layouts
  // that name the same states compare equal and normalize is idempotent.
  for (const state of DOCUMENT_STATES) {
    if (value.includes(state)) out.push(state);
  }
  return out;
}

/**
 * Fit two opposing insets inside one dimension, leaving at least `keep`.
 *
 * Shrunk in proportion so a deliberately lopsided pair stays lopsided rather
 * than being squared off.
 */
function fitPair(
  first: number,
  second: number,
  extent: number,
  keep: number,
): { first: number; second: number } {
  const total = first + second;
  const room = Math.max(0, extent - keep);
  if (total <= room) return { first, second };
  if (total <= 0) return { first: 0, second: 0 };
  const scale = room / total;
  return { first: first * scale, second: second * scale };
}
