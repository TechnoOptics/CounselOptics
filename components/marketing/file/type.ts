/**
 * The case-file type roles, spelled once. Every marketing page imports
 * these rather than composing its own headline classes, so a page cannot
 * drift back to an italic gold phrase or a display face for a sentence.
 * See docs/superpowers/specs/2026-09-05-marketing-case-file-design.md 2.1.
 */
export const H1 =
  'font-caslon font-normal text-[clamp(40px,6vw,72px)] leading-[1.02] tracking-[-0.012em] text-balance text-forest-900 dark:text-cream-100';

export const H2 =
  'font-caslon font-normal text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.1] tracking-[-0.01em] text-balance text-forest-900 dark:text-cream-100';

export const BODY =
  'font-public text-[17px] leading-[1.55] text-ink-700 dark:text-cream-100/80 max-w-[62ch]';

export const LABEL =
  'font-courier text-[12.5px] uppercase tracking-[0.08em] text-ink-600 dark:text-cream-100/60';

/**
 * The visible keyboard focus, spelled once and appended to every control
 * role below. The site's global ring (app/globals.css) is scoped to
 * `a, input, textarea, select, [tabindex]`, because every button used to
 * carry `.btn`, which brings its own ring. Marketing has raw buttons and
 * `<summary>` now, so the roles have to carry it themselves or a keyboard
 * reader gets no indication of where they are. `ring-offset-paper` is the
 * ground token, so the halo is cream on paper and forest on the enterprise
 * cover without either call site saying so.
 */
export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

export const BUTTON_INK =
  `inline-flex items-center gap-2 min-h-[44px] rounded-[3px] bg-forest-900 px-5 py-3 font-public text-[15px] font-semibold text-cream-50 no-underline hover:bg-forest-800 dark:bg-cream-100 dark:text-forest-950 dark:hover:bg-cream-50 ${FOCUS}`;

export const BUTTON_OUTLINE_CREAM =
  `inline-flex items-center gap-2 min-h-[44px] rounded-[3px] border border-cream-100/70 px-5 py-3 font-public text-[15px] font-semibold text-cream-100 no-underline hover:bg-cream-100/10 ${FOCUS}`;

export const LINK =
  `font-public text-[15px] font-semibold text-forest-900 underline underline-offset-4 decoration-rule hover:decoration-forest-900 dark:text-cream-100 dark:hover:decoration-cream-100 ${FOCUS}`;
