<script setup lang="ts">
const { locale, t } = useLocale();
const { data: collections } = await useAsyncData(
  () => `collections:${locale.value}`,
  () => useCatalog().listCollections(),
  {
    default: () => [],
  }
);
useSeoMeta({ title: () => t('collections') });
</script>

<template>
  <div class="px-[clamp(16px,4vw,48px)] py-16">
    <h1 class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase">
      {{ t('collections') }}
    </h1>
    <ul v-if="collections.length" class="border-rule m-0 mt-8 list-none border-t p-0">
      <li v-for="c in collections" :key="c.id">
        <NuxtLink
          :to="`/collections/${c.slug}`"
          class="border-rule flex justify-between border-b py-5"
        >
          <span class="tracking-[0.12em] uppercase">{{ c.title }}</span>
          <span class="text-muted">{{ c.productCount }} {{ t('products') }}</span>
        </NuxtLink>
      </li>
    </ul>
    <p v-else class="text-muted mt-6">{{ t('noCollections') }}</p>
  </div>
</template>
