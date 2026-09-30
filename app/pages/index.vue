<script setup lang="ts">
const { locale, t } = useLocale();
const organization = useOrganization();
const HOME_PRODUCT_COUNT = 8;

const { data } = await useAsyncData(
  () => `home:${locale.value}`,
  async () => {
    const cms = useCms();
    const [hero, sections, products] = await Promise.all([
      cms.hero(),
      cms.sections(),
      // A catalog failure empties the product row; it must not take the CMS hero and sections with it.
      useCatalog()
        .listProducts(undefined, HOME_PRODUCT_COUNT)
        .catch(() => []),
    ]);
    return { hero, sections, products };
  },
  { default: () => ({ hero: null, sections: [], products: [] }) }
);
</script>

<template>
  <div>
    <HomeHero v-if="data.hero" :hero="data.hero" />
    <HomeSection
      v-for="(section, i) in data.sections"
      :key="section.id"
      :section="section"
      :flip="i % 2 === 1"
    />
    <section v-if="organization.commerce" class="px-[clamp(16px,4vw,48px)] py-16">
      <div class="mb-8 flex items-baseline justify-between">
        <h2
          class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase"
        >
          {{ t('shop') }}
        </h2>
        <NuxtLink
          to="/shop"
          class="hover:text-accent border-b border-current pb-px text-[11px] tracking-[0.14em] uppercase"
        >
          {{ t('all') }}
        </NuxtLink>
      </div>
      <div
        v-if="data.products.length"
        class="grid grid-cols-2 gap-x-4 gap-y-8 min-[1200px]:grid-cols-4 md:grid-cols-3 md:gap-x-6 md:gap-y-12"
      >
        <ProductCard
          v-for="p in data.products.slice(0, HOME_PRODUCT_COUNT)"
          :key="p.id"
          :product="p"
        />
      </div>
      <p v-else class="text-muted">{{ t('noProducts') }}</p>
    </section>
  </div>
</template>
