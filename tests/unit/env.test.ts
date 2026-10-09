import { describe, expect, it } from 'vitest';
import { normalizeApiBaseUrl, resolveStorefrontEnv } from '../../shared/utils/env';

describe('normalizeApiBaseUrl', () => {
  it('defaults to production', () => {
    expect(normalizeApiBaseUrl(undefined)).toBe('https://web.eldra.app/api');
    expect(normalizeApiBaseUrl('  ')).toBe('https://web.eldra.app/api');
  });

  it('appends /api to a bare gateway origin and trims trailing slashes', () => {
    expect(normalizeApiBaseUrl('https://gateway.example.com')).toBe(
      'https://gateway.example.com/api'
    );
    expect(normalizeApiBaseUrl('https://gateway.example.com/api/')).toBe(
      'https://gateway.example.com/api'
    );
    expect(normalizeApiBaseUrl('http://localhost:8080//')).toBe('http://localhost:8080/api');
  });
});

describe('resolveStorefrontEnv', () => {
  it('reads every documented variable', () => {
    const env = resolveStorefrontEnv({
      ELDRA_ORG_ID: ' my-shop ',
      BASE_API_URL: 'https://gateway.example.com',
      NUXT_PUBLIC_CHECKOUT_URL: 'https://checkout.example.com/',
      NUXT_PUBLIC_DEFAULT_LOCATION_ID: 'loc-1',
      PREVIEW_TOKEN: 'secret',
      NUXT_SITE_URL: 'https://shop.example.com/',
      NUXT_SITE_INDEXABLE: 'true',
      NUXT_SHOP_CLIENT_ID: ' shop-client ',
      NUXT_SHOP_CLIENT_SECRET: ' client-secret ',
      NUXT_PUBLIC_SHOP_ISSUER: 'https://auth.example.com/realms/shop-1/',
      NUXT_PUBLIC_KEYCLOAK_BASE_URL: 'https://auth.example.com/',
      NUXT_SESSION_STORAGE_DRIVER: ' REDIS ',
      NUXT_SESSION_STORAGE_URL: ' redis://cache:6379 ',
    });
    expect(env).toEqual({
      apiBaseUrl: 'https://gateway.example.com/api',
      orgId: 'my-shop',
      checkoutUrl: 'https://checkout.example.com',
      previewToken: 'secret',
      siteUrl: 'https://shop.example.com',
      siteIndexable: true,
      defaultLocationId: 'loc-1',
      shopClientId: 'shop-client',
      shopClientSecret: 'client-secret',
      shopIssuer: 'https://auth.example.com/realms/shop-1',
      keycloakBaseUrl: 'https://auth.example.com',
      sessionStorage: { driver: 'redis', url: 'redis://cache:6379' },
    });
  });

  it('has safe defaults when nothing is set', () => {
    const env = resolveStorefrontEnv({});
    expect(env.orgId).toBe('');
    expect(env.checkoutUrl).toBe('');
    expect(env.previewToken).toBe('');
    expect(env.siteUrl).toBe('http://localhost:3000');
    expect(env.siteIndexable).toBe(false);
    expect(env.defaultLocationId).toBe('');
    expect(env.shopClientId).toBe('storefront');
    expect(env.shopClientSecret).toBe('');
    expect(env.shopIssuer).toBe('');
    expect(env.keycloakBaseUrl).toBe('');
    expect(env.sessionStorage).toEqual({ driver: 'memory', url: '' });
  });

  it('keeps sessions in memory for an unknown storage driver', () => {
    expect(
      resolveStorefrontEnv({ NUXT_SESSION_STORAGE_DRIVER: 'mongo' }).sessionStorage.driver
    ).toBe('memory');
  });
});
