import type { EldraClient } from '@eldrajs/sdk';

export const SHIPPED_LOCALES = ['en-US', 'is-IS'] as const;
export type Locale = (typeof SHIPPED_LOCALES)[number];
export const FALLBACK_LOCALE: Locale = 'en-US';
/** Read by @nuxtjs/i18n on the server (nuxt.config.ts) and written by useLocale().setLocale. */
export const LOCALE_COOKIE = 'storefront_locale';
export const LOCALE_LABELS: Record<Locale, string> = { 'en-US': 'EN', 'is-IS': 'ÍS' };
export const ORGANIZATION_STATE_KEY = 'eldra-organization';

export interface OrganizationSettings {
  /** The organization's UUID, even when ELDRA_ORG_ID is an alias; empty until it has been read. */
  id: string;
  name: string;
  /** ISO 4217 code from the organization's commerce settings; null when it has none. */
  currency: string | null;
  commerce: boolean;
  /** The B2B feature: business customers may sign in (when the storefront client is configured too). */
  b2b: boolean;
  /** The organization's locales that ship with this starter; never empty. */
  locales: Locale[];
  defaultLocale: Locale;
}

/**
 * The parts of GET /organization/v1/{orgId} the storefront reads, read through
 * `eldra.features.getOrganization()`. The SDK's `EldraOrganizationDetails` type has no `commerce`
 * field, so callers cast the SDK response to this shape.
 */
export interface OrganizationDetailsInput {
  id?: string;
  name?: string;
  commerce?: { currency?: string } | null;
  features?: Array<{ feature: string; enabled: boolean }> | null;
}

/** The parts of GET /organization/v1/{orgId}/i18n the storefront reads. No SDK method exists for it. */
export interface OrganizationI18nInput {
  availableLocales?: string[] | null;
  defaultLocale?: string;
}

/** Used until the organization has been read, and when it cannot be. */
export const FALLBACK_ORGANIZATION: OrganizationSettings = {
  id: '',
  name: '',
  currency: null,
  commerce: true,
  b2b: false,
  locales: [...SHIPPED_LOCALES],
  defaultLocale: FALLBACK_LOCALE,
};

export const isShippedLocale = (code: unknown): code is Locale =>
  typeof code === 'string' && (SHIPPED_LOCALES as readonly string[]).includes(code);

export function toOrganizationSettings(
  details: OrganizationDetailsInput | null,
  i18n: OrganizationI18nInput | null
): OrganizationSettings {
  const offered = (i18n?.availableLocales ?? []).filter(isShippedLocale);
  const locales: Locale[] = i18n
    ? offered.length
      ? offered
      : [FALLBACK_LOCALE]
    : [...SHIPPED_LOCALES];
  const wanted = i18n?.defaultLocale;
  const defaultLocale =
    isShippedLocale(wanted) && locales.includes(wanted) ? wanted : (locales[0] ?? FALLBACK_LOCALE);
  const enabled = (feature: string) =>
    (details?.features ?? []).some((row) => row.feature === feature && row.enabled);
  return {
    id: details?.id ?? '',
    name: details?.name ?? '',
    currency: details?.commerce?.currency || null,
    commerce: details ? enabled('ECOMMERCE') : FALLBACK_ORGANIZATION.commerce,
    b2b: enabled('B2B'),
    locales,
    defaultLocale,
  };
}

/** The locale to render: the current one when the organization offers it, else its default. */
export function pickLocale(current: string, settings: OrganizationSettings): Locale {
  return isShippedLocale(current) && settings.locales.includes(current)
    ? current
    : settings.defaultLocale;
}

// Process-level: each organization is read again five minutes after the last read, so a feature
// switched in Studio (B2B, commerce) reaches the storefront without a restart; a failed read is retried.
export const ORGANIZATION_CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { settings: Promise<OrganizationSettings>; readAt: number }>();

/**
 * Organization details have no dedicated SDK type with `commerce` (see `OrganizationDetailsInput`),
 * so they are read through `eldra.features.getOrganization()` and cast. The i18n endpoint has no SDK
 * method at all, so it is read through the raw `eldra.request()`.
 */
export function loadOrganizationSettings(
  eldra: Pick<EldraClient, 'request' | 'features'>,
  orgId: string
): Promise<OrganizationSettings> {
  const now = Date.now();
  const cached = cache.get(orgId);
  if (cached && now - cached.readAt < ORGANIZATION_CACHE_TTL_MS) return cached.settings;
  const pending = Promise.all([
    eldra.features.getOrganization({ orgId }) as Promise<OrganizationDetailsInput>,
    eldra
      .request<OrganizationI18nInput>({
        path: `/organization/v1/${encodeURIComponent(orgId)}/i18n`,
      })
      .catch(() => null),
  ])
    .then(([details, i18n]) => toOrganizationSettings(details, i18n))
    .catch(() => {
      cache.delete(orgId);
      return FALLBACK_ORGANIZATION;
    });
  cache.set(orgId, { settings: pending, readAt: now });
  return pending;
}

/** Tests only. */
export function clearOrganizationCache(): void {
  cache.clear();
}
