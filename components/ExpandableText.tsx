'use client';

import { useState } from 'react';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Collapses a long block of text to a short preview with a "View full" toggle.
 * Short text (under `clampChars`) renders as-is with no toggle. The text is
 * treated as user data (data-no-translate) - it's case content, not UI copy.
 */
export function ExpandableText({
  text,
  clampChars = 320,
  className,
}: {
  text: string;
  clampChars?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > clampChars;
  const shown = open || !long ? text : `${text.slice(0, clampChars).trimEnd()}…`;

  return (
    <div>
      <p className={className} data-no-translate>
        {shown}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 text-[12px] font-medium text-forest-700 dark:text-gold-300 hover:underline"
        >
          {open ? <T>Show less</T> : <T>View full</T>}
        </button>
      )}
    </div>
  );
}
