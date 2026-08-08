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

const TITLE_SIZE = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-3xl sm:text-4xl',
} as const;

/**
 * Weight and tracking for a page title, now that counsel sets its
 * headings in the sans rather than the serif.
 *
 * The serif carried a title at font-medium because a serif's medium
 * already has stroke contrast to spare. The same weight on the sans
 * reads under-set against the dense rows underneath it, so the weight
 * goes up and the tracking tightens with it. Kept as one constant
 * because the two only ever make sense together.
 */
const TITLE_WEIGHT = 'font-bold tracking-[-0.02em]';

const HEADER_ALIGN = {
  end: 'items-end justify-between',
  start: 'items-start justify-between',
  center: 'flex-col items-center text-center',
} as const;

const EYEBROW_VARIANT = {
  rule: 'eyebrow mb-1',
  plain:
    'mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300',
} as const;

/**
 * Page title block. `items-end` is what makes a trailing action sit on
 * the title's baseline instead of floating above it.
 *
 * `size` exists because the dashboards run a step larger than the
 * working pages, and the sub-detail pages (a signing request) run a
 * step smaller than both.
 *
 * `align="start"` is the detail-page header: a control beside a title
 * that is a name somebody typed, so it can run long. It does two things
 * the list pages must not do. It top-aligns, because baseline-aligning
 * a control against a title that wraps to two lines drops the control
 * to the second line. And it lets the title column grow, so a long
 * filename wraps under a control that stays pinned to the right rather
 * than pushing the control onto its own row. The list pages want the
 * opposite: their action drops below the title on a narrow window,
 * which a growing column would prevent.
 *
 * `children` is the slot under the title for a line the `subtitle`
 * cannot hold. `subtitle` renders a <p>, so a caller with its own
 * paragraph (the document detail's mono version/size line, and its tag
 * chips under it) would be nesting block content inside a <p>. Anything
 * passed here sits below the subtitle, unstyled.
 *
 * `align="center"` is the 404 and the gate screens: no trailing action,
 * everything stacked and centred. It drops `justify-between`, which is
 * what was pushing a lone title column to the left edge.
 *
 * `meta` is the mono particulars line - a bank and account number, a
 * referral split, when a lead came in. It is a second paragraph under
 * the subtitle rather than a use of `subtitle`, because `subtitle`
 * renders its own styled <p>: passing mono particulars through it would
 * both restyle them and, for the callers that already wrap them in a
 * <p>, nest a <p> inside a <p>.
 *
 * `subtitleClassName` owns the subtitle's box - its top margin, its
 * measure, and whether it shows at all - while the primitive keeps the
 * type and the colour. It is a replacement rather than an append,
 * because appending could not have done the job: /counsel/help is a
 * max-w-3xl page whose paragraph the default max-w-2xl rewraps, and
 * Tailwind emits `max-w-2xl` after `max-w-none`, so an appended
 * override would lose. /counsel/aid hides its subtitle under sm on
 * purpose, because that page has to fit one screen. The default
 * reproduces the classes this component used to hardcode, so the call
 * sites that do not pass it are unchanged.
 *
 * `backLink` is the "back to the list" link that sits above the title.
 * It is rendered unstyled: `eyebrow` cannot hold it, because an eyebrow
 * is uppercase micro-type with a rule in front of it and a link there
 * would read as a label rather than as something to click.
 *
 * `eyebrowVariant="plain"` is the same micro-type in gold-300 with no
 * leading rule. The 404s and the co-counsel guest headers all hand-
 * rolled it, because the rule reads as a section divider and these are
 * the first thing on the page with nothing above them to divide from.
 *
 * The title and subtitle break long words because both routinely carry
 * a name somebody typed - a matter title, a document filename - and an
 * unbroken one used to run out past the card edge.
 */
export function PageHeader({
  eyebrow,
  eyebrowVariant = 'rule',
  backLink,
  title,
  subtitle,
  subtitleClassName = 'mt-1.5 max-w-2xl',
  meta,
  action,
  size = 'md',
  align = 'end',
  className = '',
  children,
}: {
  eyebrow?: ReactNode;
  /** `plain` drops the leading rule and runs gold-300. */
  eyebrowVariant?: 'rule' | 'plain';
  /** A link above the title, styled by the caller. */
  backLink?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** The subtitle's margin, measure and visibility. Type stays here. */
  subtitleClassName?: string;
  /** A mono particulars line under the subtitle. */
  meta?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  align?: 'end' | 'start' | 'center';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header
      className={`flex flex-wrap gap-3 ${HEADER_ALIGN[align]} ${className}`}
    >
      <div className={`min-w-0 ${align === 'start' ? 'flex-1' : ''}`}>
        {backLink != null && <div className="mb-1">{backLink}</div>}
        {eyebrow != null && (
          <p className={EYEBROW_VARIANT[eyebrowVariant]}>{eyebrow}</p>
        )}
        <h1
          className={`${TITLE_WEIGHT} break-words text-forest-900 dark:text-cream-100 ${TITLE_SIZE[size]}`}
        >
          {title}
        </h1>
        {subtitle != null && (
          <p
            className={`break-words text-sm leading-relaxed text-ink-600 dark:text-cream-100/70 ${subtitleClassName}`}
          >
            {subtitle}
          </p>
        )}
        {meta != null && (
          <p className="mt-1 font-mono text-[12px] text-ink-500 dark:text-cream-100/55">
            {meta}
          </p>
        )}
        {children}
      </div>
      {action}
    </header>
  );
}

const SECTION_VARIANT = {
  label:
    'text-sm font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/60',
  display:
    'text-lg font-semibold tracking-[-0.01em] text-forest-900 dark:text-cream-100',
} as const;

/**
 * A heading for a band within a page.
 *
 * `label`, the default, is deliberately small, uppercase and muted: it
 * separates without competing with the page title, which is the one
 * thing on screen allowed to be large.
 *
 * `display` is the other heading the product actually uses, and it was
 * the more common of the two: the matter page alone wrote the same
 * serif card heading five times, for Deadlines, Time, Invoices, Trust
 * and Documents. It reads as the head of a stack of cards rather than
 * as a divider, so it is a variant here and not a second component.
 */
export function SectionTitle({
  children,
  action,
  variant = 'label',
  className = '',
}: {
  children: ReactNode;
  action?: ReactNode;
  variant?: 'label' | 'display';
  className?: string;
}) {
  return (
    // flex-wrap because a section's controls can outgrow the row: the
    // chronology heading sits beside four filter buttons, and without a
    // wrap they ran off the side of a narrow window instead of dropping
    // to the next line.
    <div
      className={`flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      <h2 className={SECTION_VARIANT[variant]}>{children}</h2>
      {action}
    </div>
  );
}

/**
 * One number with its label. The value colour is passed in by the caller
 * because it carries meaning: an overdue count is not the same reading as
 * a healthy one. Pass nothing and the value inherits the page's text
 * colour, which is the right default for a stat that is merely a fact.
 *
 * The value is `tabular-nums` rather than proportional, and there is no
 * prop for it. Billing, trust, time and tokens all put four of these
 * side by side carrying currency, and with proportional figures the
 * decimal points in a row of amounts do not line up, so the row reads
 * as ragged. Tabular figures only affect digits, so a stat whose value
 * is a word is unchanged.
 *
 * An eyebrow-style gold label and an `href` were both asked for and
 * both left out. The tiles that wanted them - the local `Stat` in
 * /counsel/trust and /counsel/time, the local `Kpi` in
 * /counsel/analytics - differ from this one in four more ways each
 * (p-5 rather than p-4, a 10.5px label, a font-medium value, an 11px
 * sub), and they colour the value with Tailwind tone classes rather
 * than a hex. Two props would not have absorbed them; six would have,
 * and six knobs is a worse component than three copies. They stay where
 * they are until somebody reconciles the type scale.
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
        className="mt-1.5 text-3xl font-semibold tabular-nums tracking-[-0.02em] text-forest-900 dark:text-cream-100"
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
      <p className="text-xl font-semibold text-forest-900 dark:text-cream-100">
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
