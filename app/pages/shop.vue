<script setup lang="ts">
const route = useRoute();
const { locale, t } = useLocale();
const selectedSlug = computed(() =>
  typeof route.query.category === 'string' ? route.query.category : ''
);

const { data: categories } = await useAsyncData(
  () => `categories:${locale.value}`,
  () => useCatalog().listCategories(),
  {
    default: () => [],
  }
);
const selected = computed(
  () => categories.value.find((c) => c.slug === selectedSlug.value) ?? null
);

const { data: products } = await useAsyncData(
  () => `shop:${locale.value}:${selected.value?.id ?? 'all'}`,
  () => useCatalog().listProducts(selected.value?.id),
  { default: () => [], watch: [selected] }
);

useSeoMeta({ title: () => selected.value?.title ?? t('shop') });
</script>

<template>
  <div class="px-[clamp(16px,4vw,48px)] py-16">
    <h1 class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase">
      {{ selected?.title ?? t('shop') }}
    </h1>
    <nav class="my-6 mb-10 flex flex-wrap gap-x-6 gap-y-2" :aria-label="t('shop')">
      <NuxtLink
        to="/shop"
        class="hover:border-ink border-b pb-[3px] text-[11px] tracking-[0.14em] uppercase"
        :class="!selected ? 'border-ink' : 'border-transparent'"
        :aria-current="!selected ? 'page' : undefined"
        data-testid="category-all"
        >{{ t('all') }}</NuxtLink
      >
      <NuxtLink
        v-for="c in categories"
        :key="c.id"
        :to="{ path: '/shop', query: { category: c.slug } }"
        class="hover:border-ink border-b pb-[3px] text-[11px] tracking-[0.14em] uppercase"
        :class="selected?.id === c.id ? 'border-ink' : 'border-transparent'"
        :aria-current="selected?.id === c.id ? 'page' : undefined"
        :data-testid="`category-${c.slug}`"
      >
        {{ c.title }}
      </NuxtLink>
    </nav>
    <div
      v-if="products.length"
      class="grid grid-cols-2 gap-x-4 gap-y-8 min-[1200px]:grid-cols-4 md:grid-cols-3 md:gap-x-6 md:gap-y-12"
      data-testid="product-grid"
    >
      <ProductCard v-for="p in products" :key="p.id" :product="p" />
    </div>
    <p v-else class="text-muted">{{ t('noProducts') }}</p>
  </div>
</template>
