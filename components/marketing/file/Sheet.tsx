import type { ReactNode } from 'react';

/**
 * A piece of the file: the exhibit index, a review memo, a matter file.
 *
 * The one element on the site with a shadow, and the one place Courier is
 * the running face. Product content is shown this way instead of inside a
 * browser frame. `assemble` opts the rows into the cover's single motion.
 *
 * `tone` names the ground the sheet sits on, and it is a choice rather
 * than a `dark:` variant on purpose. `.enterprise-shell` redefines
 * `--sheet` to the dark sheet and remaps `--forest-900` to near-black
 * while carrying no `.dark` class, so in light theme the paper ink landed
 * at about 1.3:1 on the enterprise cover and the `dark:` twin never fired.
 */
export function Sheet({
  kicker,
  kickerRight,
  title,
  tone = 'paper',
  assemble = false,
  className = '',
  children,
}: {
  kicker?: string;
  kickerRight?: string;
  title?: string;
  tone?: 'paper' | 'dark';
  assemble?: boolean;
  className?: string;
  // Optional: see the comment on Section's children for why createElement
  // call sites need this even though every real usage passes children.
  children?: ReactNode;
}) {
  const ink = tone === 'dark' ? 'text-cream-100' : 'text-forest-900 dark:text-cream-100';
  const quietInk = tone === 'dark' ? 'text-cream-100/60' : 'text-ink-600 dark:text-cream-100/60';
  const kickerRule = tone === 'dark' ? 'border-cream-100/40' : 'border-forest-900 dark:border-cream-100/40';
  return (
    <div
      className={`relative rounded-[3px] border border-rule bg-sheet p-6 font-courier text-[13.5px] ${ink} shadow-[0_30px_50px_-30px_rgba(16,40,31,0.35)] sm:p-7 ${className}`.trim()}
    >
      {(kicker || kickerRight) && (
        <div className={`flex justify-between gap-4 border-b ${kickerRule} pb-2.5 text-[12px] uppercase tracking-[0.06em] ${quietInk}`}>
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

/**
 * One ruled row: a mark (exhibit letter, step number), text, and a right-hand
 * date or status. The right column is `text-current opacity-70` rather than a
 * named quiet ink so it follows whichever tone the Sheet around it chose;
 * SheetRow is called directly by pages and these are server components, so
 * there is no context to read the tone from.
 *
 * The name wraps; it does not truncate. A long name still must not widen the
 * sheet, and `min-w-0` plus `overflow-wrap: anywhere` holds that: both floor
 * the middle track's min-content contribution at zero, so the sheet's width
 * stays a property of the layout around it rather than of its longest row.
 * `truncate` held the same floor and cost the reader the content: on the home
 * cover at 1024 every exhibit name was cut to about three characters
 * ("Signed leas...", "Move-out p..."), and a filename cut that short is not a
 * filename. The date is short and fixed, so it keeps the `auto` track and
 * `whitespace-nowrap`; the name is the content, so it takes what is left and
 * runs on to a second line. `items-baseline` keeps the mark and the date on
 * the first line's baseline, so a two-line row still reads as one line on a
 * form.
 */
export function SheetRow({ mark, text, right }: { mark: string; text: ReactNode; right?: ReactNode }) {
  return (
    <div
      data-row
      className="grid grid-cols-[34px_1fr_auto] items-baseline gap-3.5 border-b border-dotted border-rule py-2.5 last:border-b-0"
    >
      <b className="font-bold">{mark}</b>
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
      <span className="whitespace-nowrap tabular-nums text-current opacity-70">{right}</span>
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
