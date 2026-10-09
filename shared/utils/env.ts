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
  /** Server only. Business login stays off without it. */
  shopClientSecret: string;
  /** Overrides the issuer derived from `keycloakBaseUrl` and the organization id. */
  shopIssuer: string;
  keycloakBaseUrl: string;
  sessionStorage: SessionStorageEnv;
}

/** Where business-login sessions live: process memory (one server, development) or Redis. */
export interface SessionStorageEnv {
  driver: SessionStorageDriver;
  url: string;
}

export const SESSION_STORAGE_DRIVERS = ['memory', 'redis'] as const;
export type SessionStorageDriver = (typeof SESSION_STORAGE_DRIVERS)[number];

export function resolveSessionStorageDriver(value: string | undefined): SessionStorageDriver {
  const wanted = clean(value).toLowerCase();
  return (SESSION_STORAGE_DRIVERS as readonly string[]).includes(wanted)
    ? (wanted as SessionStorageDriver)
    : 'memory';
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
    shopClientSecret: clean(env.NUXT_SHOP_CLIENT_SECRET),
    shopIssuer: origin(env.NUXT_PUBLIC_SHOP_ISSUER),
    keycloakBaseUrl: origin(env.NUXT_PUBLIC_KEYCLOAK_BASE_URL),
    sessionStorage: {
      driver: resolveSessionStorageDriver(env.NUXT_SESSION_STORAGE_DRIVER),
      url: clean(env.NUXT_SESSION_STORAGE_URL),
    },
  };
}
