'use client';

import type { ReactNode } from 'react';

/**
 * One inline select in the request's action bar: a quiet label, then the
 * control, on a single line.
 *
 * Written once because the bar holds two of them and they have to agree.
 * Two hand-written copies of the same label-plus-select is exactly the
 * shape this repo has already had to repair elsewhere, and a bar whose
 * fields sit at two different heights reads as a bug before anyone works
 * out which of the two is wrong.
 *
 * Colour comes from the token set rather than the palette, so the control
 * follows the shell into dark mode without a second spelling.
 */
export function BarSelect({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  /** Already wrapped for translation by the caller. */
  label: ReactNode;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The options. */
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[11rem] truncate rounded-lg border border-edge bg-surface-2 px-3 py-1.5 text-[13px] text-foreground transition-colors focus:border-edge-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40 disabled:opacity-50"
      >
        {children}
      </select>
    </label>
  );
}
