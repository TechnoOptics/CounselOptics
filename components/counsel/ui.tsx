/**
 * The four shapes every counsel and Hub page was rebuilding by hand.
 *
 * There are around 180 tsx files under app/counsel and components/counsel
 * and each one wrote its own page header, section heading, stat tile and
 * empty state. The class strings were close but never identical, so the
 * product drifted a little with every page added. These are the shared
 * versions. Adopting one is a one-line change at the call site and it
 * removes a copy of the drift.
 *
 * Everything here is presentational and server-safe. Titles take
 * ReactNode rather than string so callers keep wrapping copy in <T> for
 * translation.
 *
 * No outer margin on purpose: counsel pages stack their sections with a
 * `space-y-*` wrapper, and a margin here would double the gap.
 */

import type { CSSProperties, ReactNode } from 'react';

/**
 * Page title block. `items-end` is what makes a trailing action sit on
 * the title's baseline instead of floating above it.
 *
 * `size` exists because the dashboards run a step larger than the
 * working pages. It is the only knob; everything else is fixed.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  size = 'md',
  className = '',
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <header
      className={`flex flex-wrap items-end justify-between gap-3 ${className}`}
    >
      <div className="min-w-0">
        {eyebrow != null && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1
          className={`font-display font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 ${
            size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-3xl'
          }`}
        >
          {title}
        </h1>
        {subtitle != null && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-cream-100/70">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

/**
 * A heading for a band within a page. Deliberately small, uppercase and
 * muted: it separates without competing with the page title, which is
 * the one thing on screen allowed to be large.
 */
export function SectionTitle({
  children,
  action,
  className = '',
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/60">
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * One number with its label. The value colour is passed in by the caller
 * because it carries meaning: an overdue count is not the same reading as
 * a healthy one. Pass nothing and the value inherits the page's text
 * colour, which is the right default for a stat that is merely a fact.
 */
export function StatCard({
  label,
  value,
  sub,
  color,
  className = '',
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Any CSS colour. Omit for a neutral stat. */
  color?: string;
  className?: string;
}) {
  const style: CSSProperties | undefined = color ? { color } : undefined;
  // No hover class: the border brighten lives on `.counsel-shell
  // .card:hover` in globals.css and outranks anything set here.
  return (
    <div
      className={`card h-full p-4 transition-colors ${className}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/60">
        {label}
      </p>
      <p
        className="mt-1.5 font-display text-3xl text-forest-900 dark:text-cream-100"
        style={style}
      >
        {value}
      </p>
      {sub != null && (
        <p className="mt-1 text-[12px] text-ink-500 dark:text-cream-100/55">
          {sub}
        </p>
      )}
    </div>
  );
}

/**
 * What a page shows when there is nothing to show. Says what would
 * appear here and, where there is one, offers the action that would put
 * something in it.
 */
export function EmptyState({
  icon,
  title,
  sub,
  action,
  className = '',
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`card flex flex-col items-center justify-center gap-2 p-10 text-center ${className}`}
    >
      {icon != null && (
        <div className="text-ink-400 dark:text-cream-100/40" aria-hidden>
          {icon}
        </div>
      )}
      <p className="font-display text-xl text-forest-900 dark:text-cream-100">
        {title}
      </p>
      {sub != null && (
        <p className="mx-auto max-w-md text-[13px] leading-relaxed text-ink-600 dark:text-cream-100/60">
          {sub}
        </p>
      )}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
