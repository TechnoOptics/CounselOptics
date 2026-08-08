/**
 * One status chip, derived from one hex.
 *
 * Every hand-rolled status chip in the app picked three Tailwind classes
 * (a background, a text colour, a ring) out of a per-file map, and the
 * maps drifted: the same state was amber in one place and emerald in
 * another, and a new state meant inventing three more classes.
 *
 * Here a caller passes a single colour and the chip derives the rest at
 * fixed alphas: text at full strength, background at 10 percent, border
 * at 25 percent. That holds for any colour, including ones nobody has
 * chosen yet, so adding a state costs one hex instead of a palette
 * decision.
 *
 * The three values are written as an inline style object on purpose.
 * Tailwind generates classes by scanning source text at build time, so
 * a class assembled from a runtime value would simply never exist in
 * the stylesheet. Arbitrary-value syntax cannot help here either.
 */

import type { CSSProperties, ReactNode } from 'react';

// The palette itself is plain data and lives in lib/pill-colors.ts, so a
// module that only needs a colour name does not have to import a React
// component to get one. Re-exported here for every existing caller.
import { PILL_COLORS, PILL_DEFAULT, pillInk } from '@/lib/pill-colors';

export { PILL_COLORS, PILL_DEFAULT };

type PillSize = 'sm' | 'md';

const SIZES: Record<PillSize, string> = {
  sm: 'px-1.5 py-[1px] text-[10px]',
  md: 'px-2 py-1 text-[11px]',
};

/*
 * Every layer goes through pillInk, which is what makes the chip follow
 * the shell it is painted in. A status hex that reads on near-black
 * cannot also read on near-white, so the palette carries a light twin
 * for each state and pillInk emits the pair. See lib/pill-colors.ts for
 * the arithmetic and for why one hex could not have done it.
 */
export function pillStyle(color: string = PILL_DEFAULT): CSSProperties {
  return {
    color: pillInk(color),
    background: pillInk(color, '1a'),
    border: `1px solid ${pillInk(color, '40')}`,
  };
}

/**
 * The fill and the edge of a state, without its foreground.
 *
 * A control that carries a status rather than reporting one (the
 * document status changer, the document filter pills) needs the state's
 * colour behind it but has to keep a bright label. At chip size the
 * tone hex reads fine, but on a 12px control sitting in a row of
 * unselected siblings in cream, the tone hex reads dimmer than its
 * neighbours and the selected item looks like the disabled one.
 *
 * The edge is a shadow rather than a border so a selected control does
 * not grow a pixel on each side against its unselected siblings, which
 * is what `ring-1` was doing for these call sites before.
 */
export function pillSurface(color: string = PILL_DEFAULT): CSSProperties {
  return {
    background: pillInk(color, '1a'),
    boxShadow: `0 0 0 1px ${pillInk(color, '40')}`,
  };
}

export function StatusPill({
  children,
  color = PILL_DEFAULT,
  size = 'md',
  dot = false,
  className = '',
}: {
  children: ReactNode;
  /** Any CSS hex. Alpha is appended, so pass 6 digits, not 8. */
  color?: string;
  size?: PillSize;
  /** A filled dot before the label, for chips that read as live state. */
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded font-semibold uppercase tracking-[0.12em] whitespace-nowrap ${SIZES[size]} ${className}`}
      style={pillStyle(color)}
    >
      {dot && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: pillInk(color) }}
        />
      )}
      {children}
    </span>
  );
}
