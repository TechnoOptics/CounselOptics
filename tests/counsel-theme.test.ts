import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  COUNSEL_THEME_COOKIE,
  counselShellClass,
} from '../lib/counsel-theme-values';

/*
 * The counsel shell has two themes now, and exactly one thing about that
 * must never drift: the default.
 *
 * Every firm user is on dark today and none of them has been asked. So
 * "no preference" has to mean dark, not the OS answer and not the
 * consumer theme, or a deploy silently repaints somebody's workspace
 * while they are reading a matter. Everything below is that one claim,
 * stated at each level it could break.
 */
describe('counsel defaults to dark, and only an explicit choice moves it', () => {
  async function themeFor(cookieValue: string | undefined) {
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      cookies: () => ({
        get: (name: string) =>
          name === COUNSEL_THEME_COOKIE && cookieValue !== undefined
            ? { value: cookieValue }
            : undefined,
      }),
    }));
    const { getCounselTheme } = await import('../lib/counsel-theme');
    return getCounselTheme();
  }

  it('is dark with no cookie at all, which is every user today', async () => {
    expect(await themeFor(undefined)).toBe('dark');
  });

  it('is dark for anything that is not exactly "light"', async () => {
    // A truncated, tampered or stale cookie value must fail toward the
    // theme people already have rather than toward the new one.
    for (const value of ['', 'Light', 'LIGHT', 'system', 'auto', 'dark', '1']) {
      expect(await themeFor(value), `cookie value ${JSON.stringify(value)}`).toBe(
        'dark',
      );
    }
  });

  it('is light only for the exact opt-in', async () => {
    expect(await themeFor('light')).toBe('light');
  });
});

describe('the shell class says which theme it is', () => {
  it('keeps `dark` on the dark shell, because every counsel rule keys off it', () => {
    expect(counselShellClass('dark', 'min-h-screen')).toBe(
      'dark counsel-shell min-h-screen',
    );
  });

  it('drops `dark` and keeps the identity class on the light shell', () => {
    const light = counselShellClass('light', 'min-h-screen');
    expect(light).toContain('counsel-shell');
    expect(light.split(/\s+/)).not.toContain('dark');
  });
});

/*
 * The other half of "nothing moves for anyone who has not asked": the
 * shells that are dark on purpose and have no toggle to change them.
 * They are pre-auth or public surfaces, so there is no preference to
 * read and no chrome to offer. If one of them ever starts resolving a
 * theme it should be a decision, not a diff nobody noticed.
 */
describe('the shells with no toggle stay hardcoded dark', () => {
  const ALWAYS_DARK = [
    'app/counsel/welcome/page.tsx',
    'app/counsel/request/page.tsx',
    'app/counsel/access-ended/page.tsx',
    'app/join/page.tsx',
    'app/guest-login/page.tsx',
    'components/auth/SessionReconnect.tsx',
    'components/counsel/CoCounselTour.tsx',
  ];

  for (const rel of ALWAYS_DARK) {
    it(`${rel} still renders a dark counsel shell`, () => {
      const src = readFileSync(
        fileURLToPath(new URL(`../${rel}`, import.meta.url)),
        'utf8',
      );
      expect(src).toMatch(/dark counsel-shell|counsel-shell dark/);
      expect(src).not.toContain('counselShellClass');
    });
  }
});
