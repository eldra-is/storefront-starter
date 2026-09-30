<script setup lang="ts">
import type { GalleryImage, ProductVariant } from '~/types/catalog';

const route = useRoute();
const { locale, t } = useLocale();
const cartStore = useCartStore();
const price = usePrice();
const organization = useOrganization();
const slug = computed(() => String(route.params.slug));

const { data: product, error } = await useAsyncData(
  () => `product:${locale.value}:${slug.value}`,
  () => useCatalog().getProduct(slug.value)
);
if (error.value) {
  // Branch on the SDK error, never its message: only a missing product (or no shop at all) is a
  // 404; anything else is the gateway failing and must not look like a missing page.
  const missing = !organization.value.commerce || isNotFound(error.value.cause);
  throw createError(
    missing
      ? { statusCode: 404, statusMessage: 'Product not found' }
      : { statusCode: 500, statusMessage: 'Product could not be loaded' }
  );
}
if (!product.value) {
  throw createError({ statusCode: 404, statusMessage: 'Product not found' });
}

const selected = ref(initialSelection(product.value.options, product.value.variants));
const selectedVariant = computed<ProductVariant | null>(() =>
  product.value
    ? resolveVariant(product.value.options, product.value.variants, selected.value)
    : null
);
const availability = ref<Map<string, { available: boolean; availableQuantity: number }>>(new Map());

onMounted(async () => {
  const ids = product.value?.variants.map((v) => v.id) ?? [];
  try {
    availability.value = await useAvailability().check(ids);
  } catch {
    // No badges; the API still enforces stock on add.
  }
});

const stock = computed(() =>
  selectedVariant.value ? (availability.value.get(selectedVariant.value.id) ?? null) : null
);
const soldOut = computed(() => stock.value?.available === false);
const lowStock = computed(() => stock.value?.available && stock.value.availableQuantity <= 3);
const was = computed(() =>
  selectedVariant.value
    ? saleCompareAt(selectedVariant.value.price, selectedVariant.value.compareAtPrice)
    : null
);

const sortByOrder = (a: GalleryImage, b: GalleryImage) => a.sortOrder - b.sortOrder;
const gallery = computed<GalleryImage[]>(() => {
  const variantMedia = (selectedVariant.value?.media ?? []) as GalleryImage[];
  const productMedia = (product.value?.mediaLinks ?? []) as GalleryImage[];
  return [...(variantMedia.length ? variantMedia : productMedia)].sort(sortByOrder);
});
const activeIndex = ref(0);
watch(gallery, () => (activeIndex.value = 0));
const activeImage = computed(() => gallery.value[activeIndex.value] ?? null);

const adding = ref(false);
const added = ref(false);
const addError = ref('');

async function addToCart() {
  if (!product.value || !selectedVariant.value) return;
  adding.value = true;
  addError.value = '';
  added.value = false;
  try {
    await cartStore.addItem(product.value.id, selectedVariant.value.id, 1);
    added.value = true;
  } catch {
    addError.value =
      cartStore.lastError === 'INSUFFICIENT_STOCK' ? t('notEnoughStock') : t('addFailed');
  } finally {
    adding.value = false;
  }
}

const seo = computed(() =>
  buildSeoMeta({ title: product.value?.title }, { image: gallery.value[0]?.url })
);
useSeoMeta({
  title: () => seo.value.title,
  description: () => seo.value.description,
  ogTitle: () => seo.value.ogTitle,
  ogDescription: () => seo.value.ogDescription,
  ogImage: () => seo.value.ogImage,
  twitterCard: () => seo.value.twitterCard,
});
</script>

<template>
  <div
    v-if="product"
    class="grid gap-10 px-[clamp(16px,4vw,48px)] pt-8 pb-20 min-[900px]:grid-cols-[7fr_5fr] min-[900px]:gap-16"
  >
    <div>
      <div class="bg-soft aspect-[4/5]">
        <img
          v-if="activeImage"
          :src="activeImage.url"
          :alt="activeImage.altText || product.title"
          class="h-full w-full object-cover"
          data-testid="pdp-image"
        />
      </div>
      <div v-if="gallery.length > 1" class="mt-2 flex gap-2">
        <button
          v-for="(img, i) in gallery"
          :key="img.assetId"
          type="button"
          class="aspect-[4/5] w-16 border"
          :class="i === activeIndex ? 'border-ink' : 'border-transparent'"
          @click="activeIndex = i"
        >
          <img
            :src="img.url"
            :alt="img.altText || product.title"
            class="h-full w-full object-cover"
          />
        </button>
      </div>
    </div>
    <div class="sticky top-[calc(var(--header-h)+24px)] self-start">
      <h1 class="text-base font-normal tracking-[0.12em] uppercase" data-testid="pdp-title">
        {{ product.title }}
      </h1>
      <p class="mt-2.5 mb-7 text-sm" data-testid="pdp-price">
        <template v-if="selectedVariant">
          <span :class="{ 'text-accent': was }">{{ price(selectedVariant.price) }}</span>
          <span v-if="was" class="price-was text-muted ml-2 line-through">{{ price(was) }}</span>
        </template>
        <span v-else class="text-muted">{{ t('chooseOptions') }}</span>
      </p>
      <ProductVariantPicker
        v-model="selected"
        :options="product.options"
        :variants="product.variants"
      />
      <p v-if="soldOut" class="text-muted mt-4 text-xs" data-testid="pdp-sold-out">
        {{ t('soldOut') }}
      </p>
      <p v-else-if="lowStock" class="text-accent mt-4 text-xs" data-testid="pdp-low-stock">
        {{ t('lowStock') }}
      </p>
      <button
        type="button"
        class="border-ink bg-ink text-paper hover:bg-paper hover:text-ink mt-7 inline-flex min-h-11 w-full items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="pdp-add-to-cart"
        :disabled="!selectedVariant || soldOut || adding"
        @click="addToCart"
      >
        {{ adding ? t('adding') : added ? t('added') : t('addToCart') }}
      </button>
      <p v-if="addError" class="text-accent mt-3">{{ addError }}</p>
      <div v-if="product.description" class="border-rule mt-10 border-t pt-6">
        <p class="mb-3 text-[11px] tracking-[0.14em] uppercase">{{ t('description') }}</p>
        <ContentRichText :node="product.description" />
      </div>
    </div>
  </div>
</template>
