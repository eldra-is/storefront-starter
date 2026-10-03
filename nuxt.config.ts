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
    public: {
      eldraApiBaseUrl: env.apiBaseUrl,
      // The browser needs the organization for its cart calls; it is public data.
      eldraOrgId: env.orgId,
      checkoutUrl: env.checkoutUrl,
      siteUrl: env.siteUrl,
      siteIndexable: env.siteIndexable,
      defaultLocationId: env.defaultLocationId,
    },
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
