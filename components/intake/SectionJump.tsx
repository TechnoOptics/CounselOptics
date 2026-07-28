'use client';

/**
 * A header button that jumps to a section of the record, opening it if the
 * user had it collapsed. Sections listen for the event rather than being
 * driven by props, so the header does not need to own their state.
 */
export const OPEN_SECTION_EVENT = 'adv:open-section';

export function SectionJump({
  target,
  children,
}: {
  target: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent(OPEN_SECTION_EVENT, { detail: { id: target } }),
        )
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-[12.5px] font-medium text-forest-900 transition-colors hover:border-gold-500/60 hover:bg-cream-50 dark:border-forest-700/60 dark:bg-forest-900/60 dark:text-cream-100 dark:hover:bg-forest-800/60"
    >
      {children}
    </button>
  );
}
