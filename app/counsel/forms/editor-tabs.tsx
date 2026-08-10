'use client';

import { useRef, type ReactNode } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { EDITOR_TABS, nextTabIndex, type EditorTabId } from './template-editor-model';

/**
 * The template editor's section strip.
 *
 * Written here rather than taken from components/Tabs.tsx or from the
 * ViewStrip in components/counsel/patterns.tsx, for two reasons that are
 * not cosmetic. components/Tabs.tsx paints through the `.tab` utility,
 * whose `text-ink-500` is the neutral this repo has already measured
 * under AA on a light counsel ground. ViewStrip is a FILTER over one list
 * (it counts rows) and carries no roving focus, no arrow keys and no
 * `aria-controls`, so a keyboard reader lands on four buttons with no
 * relationship to the panel underneath them.
 *
 * This is a tablist in the sense the ARIA pattern means: one tab stop for
 * the whole strip, arrows and Home/End inside it, and every tab pointing
 * at the panel it opens.
 *
 * Selection follows focus, which is the right choice HERE because every
 * panel is already mounted state in the same component: moving the
 * selection costs a re-render and nothing else, so a keyboard user reads
 * the panel as they arrow past it instead of having to press Enter on
 * each one to find out what is in it.
 */

/** The accent at low alpha, for the selected tab's surface. */
const ACCENT_TINT = 'color-mix(in oklab, var(--accent) 16%, transparent)';
/** The accent at ring strength, for that surface's edge. */
const ACCENT_EDGE = 'color-mix(in oklab, var(--accent) 45%, transparent)';

/** Static literals, so each one reaches the dictionary as itself. */
const TAB_LABELS: Record<EditorTabId, ReactNode> = {
  document: <T>Document</T>,
  fields: <T>Fields</T>,
  signature: <T>Signature</T>,
  preview: <T>Preview</T>,
};

export function tabId(prefix: string, id: EditorTabId) {
  return `${prefix}-tab-${id}`;
}

export function panelId(prefix: string, id: EditorTabId) {
  return `${prefix}-panel-${id}`;
}

export function EditorTabs({
  active,
  onSelect,
  attention,
  idPrefix,
}: {
  active: EditorTabId;
  onSelect: (id: EditorTabId) => void;
  /**
   * Sections holding something that has to be dealt with before this
   * template can be saved. Marked on the strip so the blocker is findable
   * from whichever section the author is standing in.
   */
  attention?: EditorTabId[];
  idPrefix: string;
}) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, EDITOR_TABS.indexOf(active));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = nextTabIndex(activeIndex, e.key, EDITOR_TABS.length);
    if (next === null) return;
    e.preventDefault();
    onSelect(EDITOR_TABS[next]);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t('Template sections')}
      onKeyDown={onKeyDown}
      // Wraps rather than scrolls. A strip that scrolls horizontally puts
      // a section offscreen on a phone with nothing saying it is there;
      // on a 375px screen these four sit on two rows, all four legible
      // and all four reachable without a gesture.
      className="flex flex-wrap gap-1 rounded-xl border border-edge bg-surface-2 p-1"
    >
      {EDITOR_TABS.map((id, i) => {
        const on = id === active;
        const flagged = attention?.includes(id) ?? false;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(idPrefix, id)}
            aria-selected={on}
            aria-controls={panelId(idPrefix, id)}
            // One tab stop for the strip: Tab reaches the selected
            // section, arrows move between sections, Tab again leaves for
            // the panel.
            tabIndex={on ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => onSelect(id)}
            style={
              on
                ? { background: ACCENT_TINT, boxShadow: `inset 0 0 0 1px ${ACCENT_EDGE}` }
                : undefined
            }
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60 ${
              on
                ? 'text-accent-text'
                : 'text-muted hover:bg-surface hover:text-foreground'
            }`}
          >
            {TAB_LABELS[id]}
            {flagged && (
              <>
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                />
                {/* Said, not only shown. A dot is invisible to a screen
                    reader and to anyone who cannot separate it from the
                    accent. */}
                <span className="sr-only">
                  {' '}
                  <T>needs attention</T>
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
