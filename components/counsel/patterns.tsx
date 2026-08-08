/**
 * The page-pattern primitives: the pieces the list, configuration-list
 * and detail pages all draw and, until now, all drew separately.
 *
 * PARITY-SPEC.md section 3 describes three page patterns that share six
 * shapes between them: a segmented view strip, a toolbar row, a card
 * with an uppercase letterspaced header, a small chip, a mono
 * reference, and a relative time. Written once here because the same
 * geometry living in three hand-written copies is the failure this
 * project has already paid for more than once.
 *
 * Not here, because it already exists: the page header (PageHeader in
 * ./ui) and the status pill with its leading dot (StatusPill in
 * ./StatusPill, which takes `dot`).
 *
 * Colour comes from the token set (`edge`, `surface`, `muted`,
 * `foreground`, `accent-text`) rather than from palette classes. The
 * accent TINT is an inline color-mix rather than a Tailwind opacity
 * modifier: the token colours are plain `var()` values, so
 * `bg-accent/15` compiles to something that does not apply. StatusPill
 * derives its own alphas the same way and for the same reason.
 *
 * Everything here is presentational. Only ViewStrip takes a callback,
 * so only the modules that use ViewStrip need to be client components.
 */

import type { CSSProperties, ReactNode } from 'react';

/** The accent at low alpha, for a selected surface. */
const ACCENT_TINT = 'color-mix(in oklab, var(--accent) 16%, transparent)';
/** The accent at ring strength, for that surface's edge. */
const ACCENT_EDGE = 'color-mix(in oklab, var(--accent) 45%, transparent)';

/**
 * The first segment of an identifier, for display.
 *
 * Advottic matters and form templates have no human-facing reference
 * number: their identity is a uuid, and there is no column to hold
 * anything else. So the mono reference the spec asks for shows what
 * actually identifies the record, shortened to the leading segment.
 * Every call site passes the full value as the title attribute, so the
 * whole id is one hover away and nothing is being implied that the
 * data does not carry.
 */
export function shortRef(id: string): string {
  return id.split('-')[0] ?? id;
}

/**
 * A reference set in the mono face: an id fragment, a slug, a number.
 *
 * `title` is the full value when the visible text is a fragment of it.
 */
export function MonoRef({
  children,
  title,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`font-mono text-[11.5px] tracking-tight text-muted ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A small bordered chip for one fact about a record: its type, its
 * scope, its jurisdiction.
 *
 * Distinct from StatusPill, which carries live state and is uppercase
 * and dotted for it. A chip is sentence case and quiet, because a row
 * of six of them is normal and six pills would be a siren.
 */
export function Chip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  /** `accent` for the one chip in a row that carries scope. */
  tone?: 'neutral' | 'accent';
  className?: string;
}) {
  const style: CSSProperties | undefined =
    tone === 'accent'
      ? { background: ACCENT_TINT, boxShadow: `inset 0 0 0 1px ${ACCENT_EDGE}` }
      : undefined;
  return (
    <span
      style={style}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] ${
        tone === 'accent'
          ? 'font-medium text-accent-text'
          : 'border border-edge text-muted'
      } ${className}`}
    >
      {children}
    </span>
  );
}

export type ViewOption = {
  key: string;
  /** A node, not a string, so the caller keeps its own <T> wrap. */
  label: ReactNode;
  /** Rows this view would show. Omit when there is nothing to count. */
  count?: number;
};

/**
 * The segmented view strip: a bordered container of named views over
 * the same set of records, one of them selected.
 *
 * Every option must be a view something can actually be in, and the
 * count is the number of records the view would show, computed from
 * the same predicate that filters them. An option whose count cannot
 * be computed does not belong here.
 */
export function ViewStrip({
  options,
  active,
  onSelect,
  label,
  className = '',
}: {
  options: ViewOption[];
  active: string;
  onSelect: (key: string) => void;
  /** Names the group for a screen reader. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex flex-wrap gap-1 rounded-xl border border-edge bg-surface-2 p-1 ${className}`}
    >
      {options.map((o) => {
        const on = o.key === active;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(o.key)}
            style={
              on
                ? {
                    background: ACCENT_TINT,
                    boxShadow: `inset 0 0 0 1px ${ACCENT_EDGE}`,
                  }
                : undefined
            }
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              on
                ? 'text-accent-text'
                : 'text-muted hover:bg-surface hover:text-foreground'
            }`}
          >
            {o.label}
            {o.count != null && (
              <span className="ml-1.5 tabular-nums opacity-70">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The toolbar row under the view strip: what narrows the set on the
 * left, what describes it on the right.
 *
 * `note` is the row count, which is why it is a prop and not just more
 * children: it is the one thing in the row that is a readout rather
 * than a control, and it always sits last.
 */
export function Toolbar({
  children,
  note,
  className = '',
}: {
  children: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface p-2 ${className}`}
    >
      {children}
      {note != null && (
        <p className="ml-auto pr-1 text-[12px] tabular-nums text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * A card whose header is an uppercase letterspaced label.
 *
 * The header is a band with its own bottom edge rather than a heading
 * floating in the padding, because the detail page stacks several of
 * these and the band is what makes each one read as a separate record
 * rather than as more of the one above it.
 *
 * `bodyClassName` exists for the one body that must not be padded: a
 * table that runs to the card's edges.
 */
export function PanelCard({
  title,
  action,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title: ReactNode;
  /** A link or control on the header's right. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          {title}
        </h2>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * The action bar the detail pattern puts above its columns: its own
 * bordered card, controls on the left, state and actions on the right.
 */
export function ActionBar({
  children,
  trailing,
  className = '',
}: {
  children: ReactNode;
  /** State readout and buttons, right-aligned. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-edge bg-surface px-4 py-3 ${className}`}
    >
      {children}
      {trailing != null && (
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {trailing}
        </div>
      )}
    </div>
  );
}

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Coarse on purpose. These render inside client components, which Next
 * also renders on the server for the first response, so a unit finer
 * than a minute would produce a different string on each side and
 * hydrate with a mismatch. Minutes are the floor and anything under
 * one reads as "just now".
 *
 * Returns null for a missing or unparseable timestamp so a caller can
 * decide what an absent date should say, rather than being handed the
 * word "Invalid".
 */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.round((Date.now() - then) / 1000);
  const ago = Math.abs(seconds);
  const future = seconds < 0;
  const say = (n: number, unit: string) =>
    future ? `in ${n}${unit}` : `${n}${unit} ago`;
  if (ago < 60) return future ? 'shortly' : 'just now';
  if (ago < 3600) return say(Math.floor(ago / 60), 'm');
  if (ago < 86400) return say(Math.floor(ago / 3600), 'h');
  if (ago < 86400 * 30) return say(Math.floor(ago / 86400), 'd');
  if (ago < 86400 * 365) return say(Math.floor(ago / (86400 * 30)), 'mo');
  return say(Math.floor(ago / (86400 * 365)), 'y');
}
