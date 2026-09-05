import type { ReactNode } from 'react';

/**
 * A piece of the file: the exhibit index, a review memo, a matter file.
 *
 * The one element on the site with a shadow, and the one place Courier is
 * the running face. Product content is shown this way instead of inside a
 * browser frame. `assemble` opts the rows into the cover's single motion.
 */
export function Sheet({
  kicker,
  kickerRight,
  title,
  assemble = false,
  className = '',
  children,
}: {
  kicker?: string;
  kickerRight?: string;
  title?: string;
  assemble?: boolean;
  className?: string;
  // Optional: see the comment on Section's children for why createElement
  // call sites need this even though every real usage passes children.
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative rounded-[3px] border border-rule bg-sheet p-6 font-courier text-[13.5px] text-forest-900 shadow-[0_30px_50px_-30px_rgba(16,40,31,0.35)] dark:text-cream-100 sm:p-7 ${className}`.trim()}
    >
      {(kicker || kickerRight) && (
        <div className="flex justify-between gap-4 border-b border-forest-900 pb-2.5 text-[12px] uppercase tracking-[0.06em] text-ink-600 dark:border-cream-100/40 dark:text-cream-100/60">
          <span>{kicker}</span>
          <span>{kickerRight}</span>
        </div>
      )}
      {title && (
        <p className="mb-4 mt-3 font-caslon-text text-[20px] leading-tight">{title}</p>
      )}
      <div className={assemble ? 'file-assemble' : undefined}>{children}</div>
    </div>
  );
}

/** One ruled row: a mark (exhibit letter, step number), text, and a right-hand date or status. */
export function SheetRow({ mark, text, right }: { mark: string; text: ReactNode; right?: ReactNode }) {
  return (
    <div
      data-row
      className="grid grid-cols-[34px_1fr_auto] items-baseline gap-3.5 border-b border-dotted border-rule py-2.5 last:border-b-0"
    >
      <b className="font-bold">{mark}</b>
      <span className="min-w-0 truncate">{text}</span>
      <span className="text-ink-600 tabular-nums dark:text-cream-100/60">{right}</span>
    </div>
  );
}

/**
 * The gold. One per page, on a sheet, rotated. `text-accent-text` rather
 * than `text-accent`: docs/DESIGN.md and lib/accent-text.ts, gold as ink
 * needs the darker cut to read on paper.
 */
export function Stamp({ line1, line2 }: { line1: string; line2: string }) {
  return (
    <span
      data-stamp
      className="absolute bottom-5 right-6 inline-block rotate-[-6deg] rounded-[2px] border-2 border-accent px-3 py-2 text-center font-courier text-[12px] font-bold uppercase leading-tight tracking-[0.12em] text-accent-text"
    >
      {line1}
      <span className="block text-[20px] tracking-[0.02em]">{line2}</span>
    </span>
  );
}
