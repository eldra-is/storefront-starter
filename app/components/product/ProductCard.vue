<script setup lang="ts">
import type { ProductListItem } from '~/types/catalog';

const props = defineProps<{ product: ProductListItem }>();
const { t } = useLocale();
const price = usePrice();
const was = computed(() => saleCompareAt(props.product.minPrice, props.product.compareAtPrice));
const range = computed(() => props.product.maxPrice > props.product.minPrice);
</script>

<template>
  <NuxtLink
    :to="`/products/${product.slug}`"
    class="group block"
    :data-testid="`product-card-${product.slug}`"
  >
    <div class="bg-soft mb-3 aspect-4/5 overflow-hidden">
      <img
        v-if="product.thumbnail?.url"
        :src="product.thumbnail.url"
        :alt="product.thumbnail.altText || product.title"
        loading="lazy"
        class="h-full w-full object-cover transition-transform duration-600 ease-out group-hover:scale-[1.03]"
      />
    </div>
    <p class="text-xs tracking-[0.06em] uppercase">{{ product.title }}</p>
    <p class="card__price mt-1 text-xs">
      <span v-if="range" class="text-muted">{{ t('from') }}&nbsp;</span>
      <span :class="{ 'text-accent': was }" data-testid="product-card-price">{{
        price(product.minPrice)
      }}</span>
      <span v-if="was" class="price-was text-muted ml-2 line-through">{{ price(was) }}</span>
    </p>
  </NuxtLink>
</template>
