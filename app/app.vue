<script setup lang="ts">
const { locale, t } = useLocale();
const organization = useOrganization();
const pricing = useCustomerPricing();
const brand = useAppConfig().brand.name;
const route = useRoute();
const config = useRuntimeConfig().public;
const siteUrl = String(config.siteUrl).replace(/\/+$/, '');

useHead({
  htmlAttrs: { lang: computed(() => locale.value.slice(0, 2)) },
  titleTemplate: (title?: string) => (title ? `${title} · ${brand}` : brand),
  link: [{ rel: 'canonical', href: computed(() => `${siteUrl}${route.path}`) }],
  // Read at runtime, like /robots.txt; a private page's own robots meta replaces this one.
  meta: [{ name: 'robots', content: config.siteIndexable ? 'index, follow' : 'noindex, nofollow' }],
});
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <LayoutSiteHeader />
    <main class="min-h-screen pt-[var(--header-h)]">
      <p
        v-if="pricing.needsCompany && route.path !== '/account'"
        class="border-rule border-b px-[clamp(16px,4vw,48px)] py-3 text-xs"
        role="status"
        data-testid="choose-company-notice"
      >
        {{ t('chooseCompanyNotice') }}
        <NuxtLink to="/account" class="ml-2 border-b border-current">{{
          t('chooseCompany')
        }}</NuxtLink>
      </p>
      <NuxtPage />
    </main>
    <LayoutSiteFooter />
    <ClientOnly>
      <CartMiniCart v-if="organization.commerce" />
    </ClientOnly>
  </div>
</template>
