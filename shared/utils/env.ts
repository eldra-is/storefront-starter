import { DEFAULT_ELDRA_API_BASE_URL } from '@eldrajs/sdk';

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
  };
}
