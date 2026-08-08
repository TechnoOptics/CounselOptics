'use server';

import { cookies } from 'next/headers';
import { COUNSEL_THEME_COOKIE, type CounselTheme } from './counsel-theme-values';

/**
 * Which way the counsel and employee-portal shells are painted.
 *
 * Dark is the default and stays the default. Every firm user is on dark
 * today and none of them has been asked, so the ABSENCE of a preference
 * means dark rather than "work it out from the OS". Light is something a
 * person opts into; nobody's workspace changes because this shipped.
 *
 * Stored in a first-party cookie, the same mechanism as the UI locale in
 * lib/i18n/locale.ts and for the same reason: the SERVER needs the
 * answer. The shell class is rendered on the server, so a cookie means
 * the first painted frame is already the right theme. localStorage plus
 * a boot script cannot do that - it would flash the wrong theme on every
 * navigation, and on a near-black-to-near-white flip that flash is the
 * whole screen.
 *
 * Both live in a 'use server' file, which means both are public HTTP
 * endpoints. Neither reads nor writes anything but this cookie, and the
 * worst a caller can do is set their own theme.
 */
export async function getCounselTheme(): Promise<CounselTheme> {
  return cookies().get(COUNSEL_THEME_COOKIE)?.value === 'light'
    ? 'light'
    : 'dark';
}

/** Persist the reader's choice. Called by the theme toggle. */
export async function setCounselThemeAction(theme: string): Promise<void> {
  cookies().set(COUNSEL_THEME_COOKIE, theme === 'light' ? 'light' : 'dark', {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // a preference, keep it a year
    sameSite: 'lax',
  });
}
