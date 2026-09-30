import { LOCALE_COOKIE, type Locale } from '~/utils/organization';

export type { Locale } from '~/utils/organization';

/**
 * Site language. @nuxtjs/i18n owns the active locale and the messages in i18n/locales; the
 * organization's locale list limits which ones a visitor can pick. The choice lives in a cookie
 * so the server renders the language the browser shows. Works outside component setup (stores,
 * async handlers) because it uses the app-wide i18n instance, not useI18n().
 */
export function useLocale() {
  const { $i18n } = useNuxtApp();
  const organization = useOrganization();
  const cookie = useCookie<Locale | null>(LOCALE_COOKIE, {
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });

  const locale = computed<Locale>(() => $i18n.locale.value as Locale);
  const locales = computed<Locale[]>(() => organization.value.locales);

  /** Callers reload afterwards so server-rendered content changes with the language. */
  function setLocale(next: Locale) {
    cookie.value = next;
  }

  function t(key: string): string {
    return $i18n.t(key);
  }

  return { locale, locales, setLocale, t };
}
