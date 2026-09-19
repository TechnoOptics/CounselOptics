import type { ReactNode } from 'react';
import { LABEL } from './type';

/**
 * The ruled block with the binder tab.
 *
 * One ink rule on top (none on the first block), a 200px tab column at lg
 * and above carrying the letter and a Courier caption, collapsing to one
 * line above the body below that. The body column carries min-w-0 so a
 * display headline can never set the page wider than the phone; that
 * exact overflow was a live defect on the old hero.
 */
export function Section({
  tab,
  label,
  first = false,
  id,
  children,
}: {
  tab?: string;
  label: string;
  first?: boolean;
  id?: string;
  // Optional (rather than required) so `createElement(Section, { label },
  // child)` typechecks: TS's createElement overloads validate the props
  // argument against the full props type before folding in trailing
  // positional children, so a required `children` key would demand it be
  // present in that object literal even though React fills it in at
  // runtime from the third argument.
  children?: ReactNode;
}) {
  // The Courier label is the only name several sections have: the home
  // page's three quotes, both pricing schedules and the enterprise sector
  // picker carry no heading at all, so without this they have no accessible
  // name and no entry in a screen reader's landmark list.
  const slug = (id ?? label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const labelId = label && slug ? `${slug}-label` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={labelId}
      className={`grid gap-4 lg:grid-cols-[200px_1fr] lg:gap-10 ${
        first
          ? 'pt-12 pb-10 sm:pt-16 sm:pb-14'
          : 'border-t border-forest-900 py-10 dark:border-cream-100/40 sm:py-14'
      }`}
    >
      <div id={labelId} className={LABEL}>
        {tab && (
          // The binder tab is a letter or a step name for the eye. It shares
          // the labelling div with the Courier caption, so without aria-hidden
          // every region announces the glyph first ("A What goes in").
          <span
            aria-hidden
            className="mb-1.5 block font-caslon text-[44px] normal-case leading-none tracking-normal text-forest-900 dark:text-cream-100"
          >
            {tab}
          </span>
        )}
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
