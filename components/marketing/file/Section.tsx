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
  return (
    <section
      id={id}
      className={`grid gap-4 lg:grid-cols-[200px_1fr] lg:gap-10 ${
        first
          ? 'pt-12 pb-10 sm:pt-16 sm:pb-14'
          : 'border-t border-forest-900 py-10 dark:border-cream-100/40 sm:py-14'
      }`}
    >
      <div className={LABEL}>
        {tab && (
          <span className="mb-1.5 block font-caslon text-[44px] normal-case leading-none tracking-normal text-forest-900 dark:text-cream-100">
            {tab}
          </span>
        )}
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
