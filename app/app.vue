<script setup lang="ts">
const { locale } = useLocale();
const organization = useOrganization();
const brand = useAppConfig().brand.name;
const route = useRoute();
const siteUrl = String(useRuntimeConfig().public.siteUrl).replace(/\/+$/, '');

useHead({
  htmlAttrs: { lang: computed(() => locale.value.slice(0, 2)) },
  titleTemplate: (title?: string) => (title ? `${title} · ${brand}` : brand),
  link: [{ rel: 'canonical', href: computed(() => `${siteUrl}${route.path}`) }],
});
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <LayoutSiteHeader />
    <main class="min-h-screen pt-[var(--header-h)]">
      <NuxtPage />
    </main>
    <LayoutSiteFooter />
    <ClientOnly>
      <CartMiniCart v-if="organization.commerce" />
    </ClientOnly>
  </div>
</template>
