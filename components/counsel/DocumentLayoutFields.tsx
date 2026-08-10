'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DOCUMENT_STATES,
  bandAppearsOnPage,
  composeFooterText,
  normalizeDocumentLayout,
  resolveContentBox,
  resolveFooterPlacement,
  resolveLetterheadBandTop,
  resolveWatermark,
  resolveWatermarkPlacement,
  type DocumentLayout,
  type DocumentState,
  type HorizontalAlign,
  type PageRule,
  type VerticalAnchor,
} from '@/lib/document-layout';
import {
  RENDERED_PAGE_HEIGHT_PT,
  RENDERED_PAGE_WIDTH_PT,
} from '@/lib/template-field-boxes';
import {
  LETTERHEAD_LINE_GAP_PT,
  letterheadDesignLines,
  type LetterheadDesign,
} from '@/lib/letterhead-design';
import { unencodableCharacters } from '@/lib/counterparty-fields';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { formatDateNumeric } from '@/lib/format';

/**
 * Where the letterhead, the watermark and the footer sit on a rendered page.
 *
 * THE PREVIEW READS THE RENDERER'S OWN ARITHMETIC. Every rectangle on the sheet
 * below comes out of lib/document-layout.ts, against the page size
 * lib/template-field-boxes.ts declares, which is the same function called with
 * the same numbers by lib/branded-document-pdf.ts. Nothing here positions
 * anything by eye. That is the whole reason the module is pure and import-free:
 * a preview that disagrees with the document is worse than no preview, because
 * the firm trusts it and finds out at the recipient.
 *
 * WHAT IT PROMISES, AND WHAT IT DOES NOT. It promises POSITION: which pages
 * each band is on, where on the page it sits, and which state the watermark
 * appears in. It does not promise a facsimile:
 *
 *   - Typeface. The renderer embeds Times; this asks the browser for the
 *     nearest thing it has. Two strings of equal point size in different
 *     families do not occupy the same width, so a line that fits on the page
 *     may wrap here, or the reverse.
 *   - The letterhead's own contents. Those are decided in the letterhead
 *     settings and drawn from letterheadDesignLines, the one layout function
 *     four other surfaces already read. A firm with an uploaded image or no
 *     letterhead at all gets the band's real geometry with a plain marker
 *     inside it, because this panel is not a second opinion about what the
 *     stationery says.
 *   - Colour. This follows the app's own ink colours and shifts with the light
 *     and dark themes.
 *
 * Controlled, so both callers own the value: the firm default in counsel
 * settings, and the per-template override in the forms editor.
 */

/** Points to preview pixels. A Letter sheet lands at 337 by 436, which fits a
 *  narrow phone without scaling and is large enough to read a footer on. */
const SCALE = 0.55;

const PAGE = {
  widthPt: RENDERED_PAGE_WIDTH_PT,
  heightPt: RENDERED_PAGE_HEIGHT_PT,
};

const px = (pt: number) => pt * SCALE;
/** PDF y, measured up from the bottom edge, to a CSS offset from the top. */
const fromTop = (yPt: number) => px(PAGE.heightPt - yPt);

/** Offsets inside the band, mirrored from the renderer's design branch. */
const BAND_BAR_PT = 8;
const BAND_FIRST_BASELINE_PT = 34;
const BAND_RULE_GAP_PT = 12;

export type LetterheadAvailability = {
  /** A design typed into the letterhead settings, if there is one. */
  design: LetterheadDesign | null;
  /** An uploaded letterhead image. */
  hasImage: boolean;
  /** A logo, which the renderer synthesizes a band from and which can also be
   *  the watermark. */
  hasLogo: boolean;
};

export function firmHasLetterhead(has: LetterheadAvailability): boolean {
  return has.design !== null || has.hasImage || has.hasLogo;
}

export function DocumentLayoutFields({
  layout,
  onChange,
  has,
  brandName,
  disabled = false,
  /** Bands the caller is not letting this panel edit, greyed out with a note. */
  lockedBands = [],
}: {
  layout: DocumentLayout;
  onChange: (next: DocumentLayout) => void;
  has: LetterheadAvailability;
  brandName: string;
  disabled?: boolean;
  lockedBands?: Array<'margins' | 'letterhead' | 'watermark' | 'footer'>;
}) {
  const t = useT();
  const [state, setState] = useState<DocumentState>('unsigned');
  const [pageNo, setPageNo] = useState(1);
  const locked = new Set(lockedBands);

  const set = <K extends keyof DocumentLayout>(key: K, patch: Partial<DocumentLayout[K]>) => {
    onChange(
      normalizeDocumentLayout({ ...layout, [key]: { ...layout[key], ...patch } }),
    );
  };

  const offersLetterhead = firmHasLetterhead(has);
  const droppable = unencodableCharacters(
    [layout.footer.text, ...DOCUMENT_STATES.map((s) => layout.watermark.text[s])].join(' '),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),auto]">
      <div className="space-y-5 min-w-0">
        <Band title={t('Page margins')} locked={locked.has('margins')}>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            <Slider
              label={t('Top')}
              value={layout.margins.topPt}
              min={18}
              max={216}
              disabled={disabled}
              onChange={(v) => set('margins', { topPt: v })}
            />
            <Slider
              label={t('Bottom')}
              value={layout.margins.bottomPt}
              min={18}
              max={216}
              disabled={disabled}
              onChange={(v) => set('margins', { bottomPt: v })}
            />
            <Slider
              label={t('Left')}
              value={layout.margins.leftPt}
              min={18}
              max={216}
              disabled={disabled}
              onChange={(v) => set('margins', { leftPt: v })}
            />
            <Slider
              label={t('Right')}
              value={layout.margins.rightPt}
              min={18}
              max={216}
              disabled={disabled}
              onChange={(v) => set('margins', { rightPt: v })}
            />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            <T>
              Margins move the body text, and with it every blank the other side
              fills in. Documents already out for signature keep the layout they
              were sent with.
            </T>
          </p>
        </Band>

        {offersLetterhead ? (
          <Band title={t('Letterhead')} locked={locked.has('letterhead')}>
            <Check
              label={t('Print the letterhead')}
              checked={layout.letterhead.show}
              disabled={disabled}
              onChange={(v) => set('letterhead', { show: v })}
            />
            {layout.letterhead.show && (
              <div className="mt-3 space-y-3">
                <PagesSelect
                  value={layout.letterhead.pages}
                  disabled={disabled}
                  onChange={(v) => set('letterhead', { pages: v })}
                />
                <Slider
                  label={t('Distance from the top of the page')}
                  value={layout.letterhead.topPt}
                  min={0}
                  max={240}
                  disabled={disabled}
                  onChange={(v) => set('letterhead', { topPt: v })}
                />
              </div>
            )}
          </Band>
        ) : (
          <Band title={t('Letterhead')} locked={false}>
            <p className="text-[12.5px] leading-relaxed text-muted">
              <T>
                There is no letterhead to place yet. Upload one, design one, or
                add your logo in firm settings, then come back and position it.
              </T>
            </p>
          </Band>
        )}

        <Band title={t('Watermark')} locked={locked.has('watermark')}>
          <Check
            label={t('Print a watermark')}
            checked={layout.watermark.show}
            disabled={disabled}
            onChange={(v) => set('watermark', { show: v })}
          />
          {layout.watermark.show && (
            <div className="mt-3 space-y-3">
              <div>
                <span className="label">
                  <T>What it says, and when</T>
                </span>
                <p className="mb-2 text-[12px] leading-relaxed text-muted">
                  <T>
                    Leave a state empty and nothing is printed in it. That is how
                    a draft mark stops once a document is signed.
                  </T>
                </p>
                <div className="space-y-2">
                  <StateRow
                    label={t('While unsigned')}
                    value={layout.watermark.text.unsigned}
                    on={layout.watermark.states.includes('unsigned')}
                    textDisabled={disabled || layout.watermark.source === 'logo'}
                    disabled={disabled}
                    onText={(v) =>
                      set('watermark', { text: { ...layout.watermark.text, unsigned: v } })
                    }
                    onToggle={(v) => set('watermark', { states: toggleState(layout, 'unsigned', v) })}
                  />
                  <StateRow
                    label={t('Once signed')}
                    value={layout.watermark.text.signed}
                    on={layout.watermark.states.includes('signed')}
                    textDisabled={disabled || layout.watermark.source === 'logo'}
                    disabled={disabled}
                    onText={(v) =>
                      set('watermark', { text: { ...layout.watermark.text, signed: v } })
                    }
                    onToggle={(v) => set('watermark', { states: toggleState(layout, 'signed', v) })}
                  />
                  <StateRow
                    label={t('On a copy sent out')}
                    value={layout.watermark.text.copy}
                    on={layout.watermark.states.includes('copy')}
                    textDisabled={disabled || layout.watermark.source === 'logo'}
                    disabled={disabled}
                    onText={(v) =>
                      set('watermark', { text: { ...layout.watermark.text, copy: v } })
                    }
                    onToggle={(v) => set('watermark', { states: toggleState(layout, 'copy', v) })}
                  />
                </div>
              </div>

              {has.hasLogo && (
                <label className="flex items-center gap-2 text-[13px] text-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-gold-500"
                    disabled={disabled}
                    checked={layout.watermark.source === 'logo'}
                    onChange={(e) =>
                      set('watermark', { source: e.target.checked ? 'logo' : 'text' })
                    }
                  />
                  <T>Use the firm logo instead of the words</T>
                </label>
              )}

              <PagesSelect
                value={layout.watermark.pages}
                disabled={disabled}
                onChange={(v) => set('watermark', { pages: v })}
              />
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <Slider
                  label={t('Strength')}
                  value={Math.round(layout.watermark.opacity * 100)}
                  min={2}
                  max={60}
                  suffix="%"
                  disabled={disabled}
                  onChange={(v) => set('watermark', { opacity: v / 100 })}
                />
                <Slider
                  label={t('Angle')}
                  value={layout.watermark.rotationDeg}
                  min={-90}
                  max={90}
                  suffix="deg"
                  disabled={disabled}
                  onChange={(v) => set('watermark', { rotationDeg: v })}
                />
                <Slider
                  label={t('Size')}
                  value={layout.watermark.sizePt}
                  min={8}
                  max={144}
                  disabled={disabled}
                  onChange={(v) => set('watermark', { sizePt: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <AlignSelect
                  label={t('Across the page')}
                  value={layout.watermark.align}
                  disabled={disabled}
                  onChange={(v) => set('watermark', { align: v })}
                />
                <AnchorSelect
                  value={layout.watermark.anchor}
                  disabled={disabled}
                  onChange={(v) => set('watermark', { anchor: v })}
                />
              </div>
            </div>
          )}
        </Band>

        <Band title={t('Footer')} locked={locked.has('footer')}>
          <Check
            label={t('Print a footer')}
            checked={layout.footer.show}
            disabled={disabled}
            onChange={(v) => set('footer', { show: v })}
          />
          {layout.footer.show && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="label" htmlFor="documentFooterText">
                  <T>Fixed text</T>
                </label>
                <input
                  id="documentFooterText"
                  className="input"
                  maxLength={120}
                  disabled={disabled}
                  placeholder={brandName}
                  value={layout.footer.text}
                  onChange={(e) => set('footer', { text: e.target.value })}
                />
                <p className="mt-1 text-[12px] text-muted">
                  <T>Left empty, the footer starts with your firm name.</T>
                </p>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <Check
                  label={t('Page numbers')}
                  checked={layout.footer.pageNumbers}
                  disabled={disabled}
                  onChange={(v) => set('footer', { pageNumbers: v })}
                />
                <Check
                  label={t('Date the document was produced')}
                  checked={layout.footer.generatedDate}
                  disabled={disabled}
                  onChange={(v) => set('footer', { generatedDate: v })}
                />
              </div>
              <PagesSelect
                value={layout.footer.pages}
                disabled={disabled}
                onChange={(v) => set('footer', { pages: v })}
              />
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <AlignSelect
                  label={t('Across the page')}
                  value={layout.footer.align}
                  disabled={disabled}
                  onChange={(v) => set('footer', { align: v })}
                />
                <Slider
                  label={t('Height above the page edge')}
                  value={layout.footer.baselinePt}
                  min={8}
                  max={144}
                  disabled={disabled}
                  onChange={(v) => set('footer', { baselinePt: v })}
                />
                <Slider
                  label={t('Type size')}
                  value={layout.footer.sizePt}
                  min={6}
                  max={14}
                  disabled={disabled}
                  onChange={(v) => set('footer', { sizePt: v })}
                />
              </div>
            </div>
          )}
        </Band>

        {droppable.length > 0 && (
          <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-700/40 dark:bg-amber-950/30">
            <p className="text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-100">
              <T>
                Some characters cannot be printed in the PDFs we generate and
                will be left out. Everywhere else in Advottic shows them as you
                typed them.
              </T>
            </p>
            <p className="text-[12.5px] text-amber-900 dark:text-amber-100" data-no-translate>
              {droppable.join(' ')}
            </p>
          </div>
        )}
      </div>

      <Preview
        layout={layout}
        has={has}
        brandName={brandName}
        state={state}
        pageNo={pageNo}
        onState={setState}
        onPage={setPageNo}
      />
    </div>
  );
}

/** The states list with one state added or removed, in canonical order. */
function toggleState(
  layout: DocumentLayout,
  state: DocumentState,
  on: boolean,
): DocumentState[] {
  const next = new Set(layout.watermark.states);
  if (on) next.add(state);
  else next.delete(state);
  return DOCUMENT_STATES.filter((s) => next.has(s));
}

/* ── The sheet ─────────────────────────────────────────────────────────── */

function Preview({
  layout,
  has,
  brandName,
  state,
  pageNo,
  onState,
  onPage,
}: {
  layout: DocumentLayout;
  has: LetterheadAvailability;
  brandName: string;
  state: DocumentState;
  pageNo: number;
  onState: (s: DocumentState) => void;
  onPage: (n: number) => void;
}) {
  const t = useT();
  const measure = useTextMeasure();
  const content = resolveContentBox(layout, PAGE);
  const bandTop = resolveLetterheadBandTop(layout, PAGE);
  const bandOnPage =
    layout.letterhead.show && bandAppearsOnPage(layout.letterhead.pages, pageNo);
  const watermark = resolveWatermark(layout, state);
  const watermarkOnPage = watermark && bandAppearsOnPage(watermark.pages, pageNo);
  const footerOnPage =
    layout.footer.show && bandAppearsOnPage(layout.footer.pages, pageNo);

  const designLines = has.design ? letterheadDesignLines(has.design) : [];
  // The band's own height, walked down with the shared gap exactly as the
  // renderer walks it, so the rule and the body start where they will on paper.
  let bandBaseline = bandTop - BAND_FIRST_BASELINE_PT;
  const drawnLines = designLines.map((line) => {
    const at = bandBaseline;
    bandBaseline -= line.size + LETTERHEAD_LINE_GAP_PT;
    return { line, baselineY: at };
  });
  const bandLastBaseline =
    drawnLines.length > 0 ? drawnLines[drawnLines.length - 1].baselineY : bandTop - 60;

  const footerLine = composeFooterText({
    layout,
    brandName,
    pageNo,
    generatedOn: formatDateNumeric(Date.now()),
  });
  const footerAt = resolveFooterPlacement({
    layout,
    page: PAGE,
    textWidthPt: measure(footerLine, layout.footer.sizePt, false).widthPt,
  });

  const markMetrics = watermark
    ? measure(watermark.source === 'logo' ? brandName : watermark.text, watermark.sizePt, true)
    : null;
  const markAt =
    watermark && markMetrics
      ? resolveWatermarkPlacement({
          layout,
          page: PAGE,
          markWidthPt: markMetrics.widthPt,
          markHeightPt: markMetrics.ascentPt,
        })
      : null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip on={state === 'unsigned'} onClick={() => onState('unsigned')}>
          <T>Unsigned</T>
        </Chip>
        <Chip on={state === 'signed'} onClick={() => onState('signed')}>
          <T>Signed</T>
        </Chip>
        <Chip on={state === 'copy'} onClick={() => onState('copy')}>
          <T>Copy sent out</T>
        </Chip>
        <span className="mx-1 h-4 w-px bg-ink-200 dark:bg-forest-700/50" />
        <Chip on={pageNo === 1} onClick={() => onPage(1)}>
          <T>Page 1</T>
        </Chip>
        <Chip on={pageNo === 2} onClick={() => onPage(2)}>
          <T>Page 2</T>
        </Chip>
      </div>

      <div className="overflow-x-auto">
        <div
          className="relative overflow-hidden rounded-sm bg-surface shadow-card ring-1 ring-edge"
          style={{ width: px(PAGE.widthPt), height: px(PAGE.heightPt) }}
          role="img"
          aria-label={t('A preview of the page at its real proportions')}
        >
          {/* The measure, so the margins are something you can see. */}
          <div
            className="absolute border border-dashed border-edge"
            style={{
              left: px(content.xPt),
              top: fromTop(content.topYPt),
              width: px(content.widthPt),
              height: px(content.topYPt - content.bottomYPt),
            }}
          />

          {bandOnPage && (
            <>
              <div
                className="absolute left-0 right-0 bg-surface"
                style={{ top: px(layout.letterhead.topPt), height: px(BAND_BAR_PT) }}
              />
              {drawnLines.length > 0 ? (
                drawnLines.map(({ line, baselineY }, i) => (
                  <p
                    key={i}
                    data-no-translate
                    className={line.bold ? 'absolute text-foreground' : 'absolute text-muted'}
                    style={{
                      left:
                        has.design?.alignment === 'center'
                          ? undefined
                          : px(content.xPt),
                      right: has.design?.alignment === 'center' ? undefined : undefined,
                      width:
                        has.design?.alignment === 'center' ? px(PAGE.widthPt) : undefined,
                      textAlign: has.design?.alignment === 'center' ? 'center' : 'left',
                      top: fromTop(baselineY) - px(line.size) * 0.8,
                      fontSize: px(line.size),
                      lineHeight: 1,
                      fontWeight: line.bold ? 600 : 400,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {line.text}
                  </p>
                ))
              ) : (
                <p
                  className="absolute font-medium uppercase tracking-[0.18em] text-foreground"
                  style={{
                    left: px(content.xPt),
                    top: fromTop(bandTop - BAND_FIRST_BASELINE_PT) - px(9),
                    fontSize: px(11),
                    lineHeight: 1,
                  }}
                >
                  {has.hasImage ? t('Your letterhead') : brandName}
                </p>
              )}
              <div
                className="absolute border-t border-edge"
                style={{
                  left: px(content.xPt),
                  width: px(content.widthPt),
                  top: fromTop(bandLastBaseline - BAND_RULE_GAP_PT),
                }}
              />
            </>
          )}

          {/* Body text, as grey rules. It is a stand-in for wording nobody has
              written yet, and its only job is to show where the measure is. */}
          <BodyRules
            content={content}
            startY={
              bandOnPage
                ? Math.min(bandLastBaseline - 36, content.topYPt)
                : content.topYPt
            }
          />

          {watermarkOnPage && markAt && markMetrics && (
            <span
              data-no-translate
              className="absolute font-semibold text-foreground"
              style={{
                left: px(markAt.xPt),
                top: fromTop(markAt.yPt) - px(markMetrics.ascentPt),
                fontSize: px(watermark.sizePt),
                lineHeight: 1,
                opacity: markAt.opacity,
                whiteSpace: 'nowrap',
                fontFamily: 'Times New Roman, Times, serif',
                // CSS turns clockwise where a PDF turns anticlockwise, and the
                // renderer turns the run about its own draw anchor, which is
                // the baseline at the start of the text.
                transformOrigin: `0 ${px(markMetrics.ascentPt)}px`,
                transform: `rotate(${-markAt.rotationDeg}deg)`,
              }}
            >
              {watermark.source === 'logo' ? brandName : watermark.text}
            </span>
          )}

          {footerOnPage && footerLine && (
            <span
              data-no-translate
              className="absolute text-muted"
              style={{
                left: px(footerAt.xPt),
                top: fromTop(footerAt.yPt) - px(layout.footer.sizePt) * 0.8,
                fontSize: px(layout.footer.sizePt),
                lineHeight: 1,
                whiteSpace: 'nowrap',
                fontFamily: 'Times New Roman, Times, serif',
              }}
            >
              {footerLine}
            </span>
          )}
        </div>
      </div>

      <p className="max-w-[340px] text-[11.5px] leading-relaxed text-muted">
        <T>
          Positions are the ones the PDF will use. Type is drawn in your
          browser&rsquo;s nearest font, so line widths are close rather than
          exact.
        </T>
      </p>
    </div>
  );
}

/** Grey rules standing in for body text, from the first line to the floor. */
function BodyRules({
  content,
  startY,
}: {
  content: ReturnType<typeof resolveContentBox>;
  startY: number;
}) {
  const LEAD = 16;
  const rules: number[] = [];
  for (let y = startY; y > content.bottomYPt + LEAD; y -= LEAD) rules.push(y);
  return (
    <>
      {rules.slice(0, 40).map((y, i) => (
        <div
          key={y}
          className="absolute bg-ink-200/70"
          style={{
            left: px(content.xPt),
            top: fromTop(y),
            // A short last line per paragraph, so the block reads as prose
            // rather than as a grid.
            width: px(content.widthPt * (i % 7 === 6 ? 0.55 : 1)),
            height: Math.max(1, px(5)),
          }}
        />
      ))}
    </>
  );
}

/**
 * Measure a run the way the renderer does, as closely as a browser can.
 *
 * Canvas rather than a constant per character: the width of a footer line
 * decides where a centred or right-aligned one starts, and a guess would put
 * the preview's footer somewhere the document's is not. The ascent is measured
 * too, because the renderer centres the INK of a watermark rather than its em
 * box, and a preview that centred the em box would disagree with the page by
 * more the larger the mark got.
 */
function useTextMeasure() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    canvas.current = document.createElement('canvas');
    setReady(true);
  }, []);
  return useMemo(() => {
    return (text: string, sizePt: number, bold: boolean) => {
      const ctx = ready ? canvas.current?.getContext('2d') : null;
      if (!ctx || !text) {
        // Server render and the first paint. Times capitals average about
        // seven tenths of the point size; close enough that the sheet does not
        // visibly jump when the real measurement arrives a frame later.
        return { widthPt: text.length * sizePt * 0.5, ascentPt: sizePt * 0.7 };
      }
      ctx.font = `${bold ? 'bold ' : ''}${sizePt}px "Times New Roman", Times, serif`;
      const m = ctx.measureText(text);
      return {
        widthPt: m.width,
        ascentPt: m.actualBoundingBoxAscent || sizePt * 0.7,
      };
    };
  }, [ready]);
}

/* ── Small controls, in the counsel house style ────────────────────────── */

function Band({
  title,
  locked,
  children,
}: {
  title: string;
  locked: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-lg p-3.5 ring-1 ring-edge ${
        locked ? 'pointer-events-none opacity-45' : ''
      }`}
      aria-disabled={locked || undefined}
    >
      <h3
        className="mb-2 text-[13px] font-semibold text-foreground"
        data-no-translate
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[12.5px] text-foreground">
        <span data-no-translate>{label}</span>
        <span className="tabular-nums text-muted" data-no-translate>
          {Math.round(value)}
          {suffix ?? 'pt'}
        </span>
      </span>
      <input
        type="range"
        className="mt-1 w-full accent-gold-500"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-foreground">
      <input
        type="checkbox"
        className="h-4 w-4 accent-gold-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span data-no-translate>{label}</span>
    </label>
  );
}

function StateRow({
  label,
  value,
  on,
  disabled,
  textDisabled,
  onText,
  onToggle,
}: {
  label: string;
  value: string;
  on: boolean;
  disabled: boolean;
  textDisabled: boolean;
  onText: (v: string) => void;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-gold-500"
        checked={on}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span
        className="w-[9.5rem] shrink-0 text-[12.5px] text-foreground"
        data-no-translate
      >
        {label}
      </span>
      <input
        className="input py-1.5"
        maxLength={40}
        value={value}
        disabled={textDisabled || !on}
        onChange={(e) => onText(e.target.value)}
      />
    </div>
  );
}

function PagesSelect({
  value,
  disabled,
  onChange,
}: {
  value: PageRule;
  disabled: boolean;
  onChange: (v: PageRule) => void;
}) {
  const t = useT();
  return (
    <label className="block">
      <span className="label">
        <T>Which pages</T>
      </span>
      <select
        className="input py-1.5"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as PageRule)}
      >
        <option value="all">{t('Every page')}</option>
        <option value="first">{t('First page only')}</option>
        <option value="all_except_first">{t('Every page after the first')}</option>
      </select>
    </label>
  );
}

function AlignSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: HorizontalAlign;
  disabled: boolean;
  onChange: (v: HorizontalAlign) => void;
}) {
  const t = useT();
  return (
    <label className="block">
      <span className="label" data-no-translate>
        {label}
      </span>
      <select
        className="input py-1.5"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as HorizontalAlign)}
      >
        <option value="left">{t('Left')}</option>
        <option value="center">{t('Centred')}</option>
        <option value="right">{t('Right')}</option>
      </select>
    </label>
  );
}

function AnchorSelect({
  value,
  disabled,
  onChange,
}: {
  value: VerticalAnchor;
  disabled: boolean;
  onChange: (v: VerticalAnchor) => void;
}) {
  const t = useT();
  return (
    <label className="block">
      <span className="label">
        <T>Down the page</T>
      </span>
      <select
        className="input py-1.5"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as VerticalAnchor)}
      >
        <option value="top">{t('Top')}</option>
        <option value="middle">{t('Middle')}</option>
        <option value="bottom">{t('Bottom')}</option>
      </select>
    </label>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ring-1 transition-colors ${
        on
          ? 'bg-gold-500/20 text-gold-700 ring-gold-500/40 dark:text-gold-200'
          : 'text-muted ring-edge hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  );
}
