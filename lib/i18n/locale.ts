'use server';

import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, type LocaleCode } from './locales';

/**
 * The user's chosen UI locale (#14), stored in a first-party cookie so
 * both the server (initial dir/lang) and the client auto-translate
 * provider read the same value. Defaults to English.
 *
 * Module-private (not exported): a 'use server' file may only export
 * async functions, and nothing else needs the cookie name.
 */
const LOCALE_COOKIE = 'adv_locale';

export async function getLocaleCookie(): Promise<LocaleCode> {
  const v = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Persist the user's locale choice. Called by the language switcher. */
export async function setLocaleAction(locale: string): Promise<void> {
  const value = isLocale(locale) ? locale : DEFAULT_LOCALE;
  cookies().set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // a preference, keep it a year
    sameSite: 'lax',
  });
}
