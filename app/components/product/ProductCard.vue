<script setup lang="ts">
import type { ProductListItem } from '~/types/catalog';

const props = defineProps<{ product: ProductListItem }>();
const { t } = useLocale();
const price = usePrice();
// listPrice is there only on a signed-in business customer's read: label it as their price.
const display = computed(() =>
  priceDisplay({
    price: props.product.minPrice,
    listPrice: props.product.listPrice,
    compareAtPrice: props.product.compareAtPrice,
  })
);
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
      <span :class="{ 'text-accent': display.was }" data-testid="product-card-price">{{
        price(product.minPrice)
      }}</span>
      <template v-if="display.was">
        <span v-if="display.customer" class="sr-only">{{ t('listPrice') }}:</span>
        <span class="price-was text-muted ml-2 line-through">{{ price(display.was) }}</span>
      </template>
    </p>
    <p
      v-if="display.customer"
      class="text-muted mt-0.5 text-[10px] tracking-[0.14em] uppercase"
      data-testid="product-card-customer-price"
    >
      {{ t('companyPrice') }}
    </p>
  </NuxtLink>
</template>
