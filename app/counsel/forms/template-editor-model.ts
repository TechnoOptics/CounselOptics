import { isReservedFirmKey } from '@/lib/firm-template-placeholders';
import type { TemplateField } from '@/lib/firm-templates';
import type { DetectedBlank } from '@/lib/template-blank-detection';
import type { DocumentLayout } from '@/lib/document-layout';

/**
 * The template editor's decisions, with none of its markup.
 *
 * The editor is a client component and this repo's suite runs in
 * `environment: node` with no DOM, so nothing rendered can be proven. What
 * CAN be proven is the arithmetic underneath: which keys a body produces,
 * which fields those keys become, which layout bands get written, how a
 * dismissed suggestion is identified, and where an arrow key lands. Each of
 * those is a rule somebody can get wrong silently, so each one lives here
 * and is covered by tests/template-editor-tabs.test.ts.
 */

export type EditorTabId = 'document' | 'fields' | 'signature' | 'preview';

/**
 * The four sections of the editor, in the order the work is done in: write
 * the document, name what gets filled in, decide how it is signed, then look
 * at the page it becomes.
 *
 * Ids only. Each label is a static `<T>Document</T>` at the point it is
 * rendered, which is how the counsel dictionary picks a string up; a label
 * carried through a variable would reach the translator as an expression and
 * ship untranslated.
 */
export const EDITOR_TABS: EditorTabId[] = [
  'document',
  'fields',
  'signature',
  'preview',
];

/**
 * Where a key press moves the selected tab, or null when the strip should
 * keep its hands off the key.
 *
 * Left and right only. The strip is horizontal, so ArrowUp and ArrowDown
 * belong to the page: a tablist that swallowed them would stop the panel
 * below it scrolling, which is the more common thing a person is trying to
 * do on a long editor.
 */
export function nextTabIndex(
  current: number,
  key: string,
  count: number,
): number | null {
  if (count < 1) return null;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Every `{{placeholder}}` the body declares, once each, in reading order.
 *
 * Reserved keys resolve from the firm record, so they are not something an
 * employee fills in. Deriving a field from one would put an empty required
 * "Firm Name" input on the form and disable the very substitution the author
 * asked for.
 */
export function extractKeys(body: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const k = m[1].toLowerCase();
    if (isReservedFirmKey(k)) continue;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

/**
 * The field list, derived FROM the body so an author never keeps two lists in
 * sync. A key the body no longer mentions drops out with its settings, which
 * is the point: what is saved is what the document actually asks for.
 */
export function deriveFields(
  body: string,
  fieldMeta: Record<string, TemplateField>,
): TemplateField[] {
  return extractKeys(body).map(
    (k) =>
      fieldMeta[k] ?? {
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        type: /date/.test(k) ? 'date' : 'text',
        required: true,
      },
  );
}

export const LAYOUT_BANDS = ['margins', 'letterhead', 'watermark', 'footer'] as const;
export type LayoutBand = (typeof LAYOUT_BANDS)[number];
export const LAYOUT_BAND_LABELS: Record<LayoutBand, string> = {
  margins: 'Margins',
  letterhead: 'Letterhead',
  watermark: 'Watermark',
  footer: 'Footer',
};

/**
 * What actually gets written to the template row: only the bands the author
 * took over. Null when they took over none, which is the same value as
 * "follow the firm", so a template that overrides nothing keeps moving with
 * firm settings instead of pinning today's copy of them.
 */
export function layoutOverride(
  overridden: Set<LayoutBand>,
  draft: DocumentLayout,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const band of LAYOUT_BANDS) {
    if (overridden.has(band)) out[band] = draft[band];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A detected blank, identified by what it describes rather than by where it
 * sits. An index would be invalidated by the next keystroke, and a dismissal
 * that survived an edit to the very text it is about would hide a blank the
 * author has just changed their mind over.
 */
export function blankIdentity(b: DetectedBlank): string {
  return `${b.kind}|${b.key ?? b.label ?? ''}|${b.context}`;
}

/** The editor's shared input skin, so four panels cannot drift apart. */
export const INPUT_CLS =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100';
