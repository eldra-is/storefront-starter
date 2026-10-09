import tailwindcss from '@tailwindcss/vite';
import { eldra } from '@eldrajs/sdk/vite';
import { resolveStorefrontEnv } from './shared/utils/env';
import { LOCALE_COOKIE } from './app/utils/organization';

const env = resolveStorefrontEnv(process.env);

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: true,

  modules: ['@pinia/nuxt', '@nuxtjs/i18n'],

  runtimeConfig: {
    // Server-only; NUXT_PREVIEW_TOKEN overrides it at runtime. Never public.
    previewToken: env.previewToken,
    // Business login, server-only. The secret and the Redis URL are left out of the build: Nuxt
    // reads NUXT_SHOP_CLIENT_SECRET and NUXT_SESSION_STORAGE_URL from the environment at runtime
    // (and from .env under pnpm dev). Storage: server/plugins/session-storage.ts.
    shopClientId: env.shopClientId,
    shopClientSecret: '',
    sessionStorage: { driver: env.sessionStorage.driver, url: '' },
    public: {
      eldraApiBaseUrl: env.apiBaseUrl,
      // The browser needs the organization for its cart calls; it is public data.
      eldraOrgId: env.orgId,
      checkoutUrl: env.checkoutUrl,
      siteUrl: env.siteUrl,
      siteIndexable: env.siteIndexable,
      defaultLocationId: env.defaultLocationId,
      // The shop realm's issuer, or the Keycloak base URL it is derived from (with the org's UUID).
      shopIssuer: env.shopIssuer,
      keycloakBaseUrl: env.keycloakBaseUrl,
    },
  },

  // The account page renders a signed-in person's data: never let a cache keep it.
  routeRules: { '/account': { headers: { 'cache-control': 'no-store' } } },

  nitro: {
    // Business-login sessions and logins in flight. Memory by default; the Redis mount replaces it
    // at runtime when NUXT_SESSION_STORAGE_DRIVER=redis (server/plugins/session-storage.ts).
    storage: { 'eldra-session': { driver: 'memory' } },
    devStorage: { 'eldra-session': { driver: 'memory' } },
  },

  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en-US',
    locales: [
      { code: 'en-US', language: 'en-US', name: 'English', file: 'en-US.json' },
      { code: 'is-IS', language: 'is-IS', name: 'Íslenska', file: 'is-IS.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: LOCALE_COOKIE,
      redirectOn: 'root',
      alwaysRedirect: false,
      fallbackLocale: 'en-US',
    },
  },

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [
      tailwindcss(),
      // Writes .eldra/web-studio (git-ignored here; a site built from the starter commits it).
      eldra({ apiBaseUrl: env.apiBaseUrl, orgId: env.orgId, skipOnMissingConfig: true }),
    ],
  },

  typescript: {
    tsConfig: {
      include: ['../.eldra/**/*.ts'],
    },
  },

  app: {
    head: {
      title: 'Storefront Starter',
      htmlAttrs: { lang: 'en' },
      // robots is set in app.vue from runtime config, so NUXT_PUBLIC_SITE_INDEXABLE works after a build.
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
});
