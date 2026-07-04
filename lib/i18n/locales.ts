/**
 * Runtime-i18n locale registry (#14). English is the authoring base;
 * every other locale is produced by runtime machine translation
 * (lib/i18n/translate.ts), cached in ui_translations.
 *
 * Kept dependency-free so it's shared by the server translate route,
 * the locale cookie helpers, and the client language switcher.
 */

export type LocaleCode =
  | 'en'
  | 'es'
  | 'zh'
  | 'fr'
  | 'pt'
  | 'de'
  | 'ar'
  | 'hi'
  | 'ja'
  | 'ru'
  | 'ko';

export type LocaleDef = {
  code: LocaleCode;
  /** English name, for settings copy. */
  englishName: string;
  /** Endonym, shown in the switcher so speakers recognize it. */
  nativeName: string;
  /** The language name we send to the translation engine. */
  translationTarget: string;
  /** Text direction. Arabic is right-to-left. */
  dir: 'ltr' | 'rtl';
};

export const DEFAULT_LOCALE: LocaleCode = 'en';

// English base + the top-10 target languages.
export const LOCALES: LocaleDef[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', translationTarget: 'English', dir: 'ltr' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', translationTarget: 'Spanish', dir: 'ltr' },
  { code: 'zh', englishName: 'Chinese (Simplified)', nativeName: '简体中文', translationTarget: 'Simplified Chinese', dir: 'ltr' },
  { code: 'fr', englishName: 'French', nativeName: 'Français', translationTarget: 'French', dir: 'ltr' },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', translationTarget: 'Portuguese', dir: 'ltr' },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', translationTarget: 'German', dir: 'ltr' },
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', translationTarget: 'Arabic', dir: 'rtl' },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', translationTarget: 'Hindi', dir: 'ltr' },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語', translationTarget: 'Japanese', dir: 'ltr' },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', translationTarget: 'Russian', dir: 'ltr' },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어', translationTarget: 'Korean', dir: 'ltr' },
];

const BY_CODE = new Map<string, LocaleDef>(LOCALES.map((l) => [l.code, l]));

export function isLocale(v: unknown): v is LocaleCode {
  return typeof v === 'string' && BY_CODE.has(v);
}

export function getLocale(code: string | undefined | null): LocaleDef {
  return (code && BY_CODE.get(code)) || BY_CODE.get(DEFAULT_LOCALE)!;
}

export function localeDir(code: string | undefined | null): 'ltr' | 'rtl' {
  return getLocale(code).dir;
}
