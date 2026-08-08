'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setCounselThemeAction } from '@/lib/counsel-theme';
import type { CounselTheme } from '@/lib/counsel-theme-values';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Dark or light, for the counsel and employee-portal shells.
 *
 * A two-option segmented control rather than a switch, because a switch
 * has to be read to be understood ("is the moon the current state or the
 * thing it will become?") and this one is glanced at. Both options are
 * always visible and the current one is filled.
 *
 * The write is a server action rather than a class flip in the browser.
 * The shell class is server-rendered, so a client-side flip would be
 * correct until the next navigation and then snap back; a refresh after
 * the cookie is set makes the server the only place the answer lives.
 * The cost is one round trip on a control nobody uses twice a day.
 *
 * `disabled` on the pending option, not on both, so the control never
 * looks broken while the refresh is in flight.
 */
export function CounselThemeToggle({ theme }: { theme: CounselTheme }) {
  const router = useRouter();
  const [choice, setChoice] = useState<CounselTheme>(theme);
  const [pending, startTransition] = useTransition();

  function pick(next: CounselTheme) {
    if (next === choice || pending) return;
    setChoice(next);
    startTransition(async () => {
      await setCounselThemeAction(next).catch(() => undefined);
      router.refresh();
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Workspace theme"
      className="inline-flex rounded-lg ring-1 ring-edge p-0.5 gap-0.5"
      data-no-translate
    >
      {(['dark', 'light'] as const).map((option) => {
        const active = choice === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={pending && !active}
            onClick={() => pick(option)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50 ${
              active
                ? 'bg-surface-2 text-foreground'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {option === 'dark' ? <MoonIcon /> : <SunIcon />}
            {/* Two literal labels rather than one translation wrap around
                a ternary: a wrap whose child is an expression cannot be
                read by the counsel i18n invariant guard, which has no way
                to know the expression is a static label. */}
            {option === 'dark' ? <T>Dark</T> : <T>Light</T>}
          </button>
        );
      })}
    </div>
  );
}

function MoonIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}
