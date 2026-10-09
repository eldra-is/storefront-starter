<script setup lang="ts">
const route = useRoute();
const { locale, t } = useLocale();
const slug = computed(() => String(route.params.slug));

const catalog = useCatalog();

const { data } = await useAsyncData(
  () => catalog.key(`collection:${locale.value}:${slug.value}`),
  async () => {
    const [collection, products] = await Promise.all([
      catalog.getCollection(slug.value),
      catalog.listCollectionProducts(slug.value),
    ]);
    return { collection, products };
  }
);
if (!data.value?.collection) {
  throw createError({ statusCode: 404, statusMessage: 'Collection not found' });
}

useSeoMeta({ title: () => data.value?.collection?.title ?? '' });
</script>

<template>
  <div v-if="data?.collection" class="px-[clamp(16px,4vw,48px)] py-16">
    <p class="text-muted text-[11px] tracking-[0.14em] uppercase">{{ t('collections') }}</p>
    <h1 class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase">
      {{ data.collection.title }}
    </h1>
    <div
      v-if="data.products.length"
      class="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 min-[1200px]:grid-cols-4 md:grid-cols-3 md:gap-x-6 md:gap-y-12"
    >
      <ProductCard v-for="p in data.products" :key="p.id" :product="p" />
    </div>
    <p v-else class="text-muted mt-10">{{ t('noProducts') }}</p>
  </div>
</template>
