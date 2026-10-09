import { DEFAULT_ELDRA_API_BASE_URL, ELDRA_SHOP_CLIENT_ID } from '@eldrajs/sdk';

/** The gateway origin with `/api` appended when missing; production when unset. */
export function normalizeApiBaseUrl(url: string | undefined): string {
  const trimmed = (url ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_ELDRA_API_BASE_URL;
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export interface StorefrontEnv {
  apiBaseUrl: string;
  orgId: string;
  checkoutUrl: string;
  previewToken: string;
  siteUrl: string;
  siteIndexable: boolean;
  defaultLocationId: string;
  /** The shop realm's storefront client; `storefront` unless the realm was set up differently. */
  shopClientId: string;
  /** Overrides the issuer derived from `keycloakBaseUrl` and the organization id. */
  shopIssuer: string;
  keycloakBaseUrl: string;
  /**
   * NUXT_SESSION_STORAGE_DRIVER, lower-cased; empty when unset. The client secret and the Redis URL
   * are deliberately not here: Nuxt reads them at runtime, so they never reach the build output.
   */
  sessionStorageDriver: string;
  /** NUXT_TRUST_PROXY=true: take the request origin from X-Forwarded-Host/-Proto (behind a TLS proxy). */
  trustProxy: boolean;
}

const clean = (value: string | undefined) => (value ?? '').trim();
const origin = (value: string | undefined) => clean(value).replace(/\/+$/, '');

/** Every variable in .env.example, read once by nuxt.config.ts. */
export function resolveStorefrontEnv(env: Record<string, string | undefined>): StorefrontEnv {
  return {
    apiBaseUrl: normalizeApiBaseUrl(env.BASE_API_URL),
    orgId: clean(env.ELDRA_ORG_ID),
    checkoutUrl: origin(env.NUXT_PUBLIC_CHECKOUT_URL),
    previewToken: clean(env.PREVIEW_TOKEN),
    siteUrl: origin(env.NUXT_SITE_URL) || 'http://localhost:3000',
    siteIndexable: clean(env.NUXT_SITE_INDEXABLE) === 'true',
    defaultLocationId: clean(env.NUXT_PUBLIC_DEFAULT_LOCATION_ID),
    shopClientId: clean(env.NUXT_SHOP_CLIENT_ID) || ELDRA_SHOP_CLIENT_ID,
    shopIssuer: origin(env.NUXT_PUBLIC_SHOP_ISSUER),
    keycloakBaseUrl: origin(env.NUXT_PUBLIC_KEYCLOAK_BASE_URL),
    sessionStorageDriver: clean(env.NUXT_SESSION_STORAGE_DRIVER).toLowerCase(),
    trustProxy: clean(env.NUXT_TRUST_PROXY) === 'true',
  };
}
