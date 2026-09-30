<script setup lang="ts">
const cartStore = useCartStore();
const { t } = useLocale();
const price = usePrice();
const route = useRoute();
const router = useRouter();

const notice = ref('');
const recovering = ref(false);

onMounted(async () => {
  const token = typeof route.query.recovery === 'string' ? route.query.recovery : '';
  if (!token) {
    await cartStore.loadCart();
    return;
  }
  recovering.value = true;
  try {
    const { restored, missing } = await cartStore.recoverBasket(token);
    if (restored > 0) notice.value = missing > 0 ? t('basketPartial') : t('basketRestored');
    else notice.value = t('linkExpired');
  } finally {
    recovering.value = false;
    await router.replace({ query: {} });
  }
});

const items = computed(() => cartStore.cart?.items ?? []);
const totals = computed(() => cartStore.cart?.totals);
const currency = computed(() => cartStore.cart?.currency);

const code = ref('');
const applying = ref(false);
const codeError = ref('');

async function applyCode() {
  applying.value = true;
  codeError.value = '';
  try {
    const ok = await cartStore.applyDiscount(code.value);
    if (ok) code.value = '';
    else codeError.value = t('codeRejected');
  } finally {
    applying.value = false;
  }
}

async function setQuantity(itemId: string, quantity: number) {
  if (quantity < 1) await cartStore.removeItem(itemId);
  else await cartStore.updateQuantity(itemId, quantity);
}

useSeoMeta({ title: () => t('cart') });
</script>

<template>
  <div class="px-[clamp(16px,4vw,48px)] py-16">
    <h1 class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase">
      {{ t('cart') }}
    </h1>
    <p v-if="notice" class="mt-4" data-testid="cart-recovery-notice">{{ notice }}</p>
    <!-- The cart lives in the browser only; rendering it on the server would only produce a mismatch. -->
    <ClientOnly>
      <p v-if="recovering" class="text-muted">…</p>
      <div
        v-else-if="items.length === 0"
        class="mt-8 grid justify-items-start gap-6"
        data-testid="cart-empty"
      >
        <p class="text-muted">{{ t('emptyCart') }}</p>
        <NuxtLink
          to="/shop"
          class="border-ink bg-paper text-ink hover:bg-ink hover:text-paper inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150"
        >
          {{ t('continueShopping') }}
        </NuxtLink>
      </div>
      <div v-else class="mt-10 grid gap-12 min-[900px]:grid-cols-[7fr_4fr] min-[900px]:gap-16">
        <ul class="border-rule m-0 list-none border-t p-0" data-testid="cart-lines">
          <li
            v-for="item in items"
            :key="item.id"
            class="border-rule grid grid-cols-[96px_1fr_auto] gap-5 border-b py-6"
            :data-testid="`cart-line-${item.variantId}`"
          >
            <div class="bg-soft aspect-[4/5]">
              <img
                v-if="item.thumbnail?.url"
                :src="item.thumbnail.url"
                :alt="item.title"
                class="h-full w-full object-cover"
              />
            </div>
            <div>
              <p class="text-xs tracking-[0.06em] uppercase" data-testid="cart-line-title">
                {{ item.title }}
              </p>
              <p class="text-muted mt-1 text-xs">
                {{
                  (item.optionSnapshots ?? [])
                    .map((o) => o.optionValueName ?? o.optionValueKey)
                    .join(' · ')
                }}
              </p>
              <div class="mt-4 flex items-center gap-5">
                <div class="border-ink inline-flex border" :aria-label="t('quantity')">
                  <button
                    type="button"
                    class="h-9 w-9"
                    :data-testid="`cart-dec-${item.variantId}`"
                    @click="setQuantity(item.id, item.quantity - 1)"
                  >
                    −
                  </button>
                  <span
                    class="w-9 text-center leading-9"
                    :data-testid="`cart-qty-${item.variantId}`"
                    >{{ item.quantity }}</span
                  >
                  <button
                    type="button"
                    class="h-9 w-9"
                    :data-testid="`cart-inc-${item.variantId}`"
                    @click="setQuantity(item.id, item.quantity + 1)"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  class="border-b border-current text-[11px] tracking-[0.14em] uppercase"
                  :data-testid="`cart-remove-${item.variantId}`"
                  @click="cartStore.removeItem(item.id)"
                >
                  {{ t('remove') }}
                </button>
              </div>
            </div>
            <p class="text-[13px]">{{ price(item.price * item.quantity, currency) }}</p>
          </li>
        </ul>
        <aside class="sticky top-[calc(var(--header-h)+24px)] self-start">
          <form @submit.prevent="applyCode">
            <label class="mb-2.5 block text-[11px] tracking-[0.14em] uppercase" for="discount-code">
              {{ t('discountCode') }}
            </label>
            <div
              v-if="cartStore.cart?.discountCode"
              class="border-ink flex min-h-11 items-center justify-between border px-3"
            >
              <span data-testid="cart-discount-applied">{{ cartStore.cart.discountCode }}</span>
              <button
                type="button"
                class="border-b border-current text-[11px] tracking-[0.14em] uppercase"
                data-testid="cart-discount-remove"
                @click="cartStore.removeDiscount()"
              >
                {{ t('remove') }}
              </button>
            </div>
            <div v-else class="grid grid-cols-[1fr_auto] gap-2">
              <input
                id="discount-code"
                v-model="code"
                class="border-ink bg-paper focus:ring-ink min-h-11 min-w-0 border px-3 outline-none focus:ring-1"
                autocomplete="off"
                data-testid="cart-discount-input"
              />
              <button
                type="submit"
                class="border-ink bg-ink text-paper hover:bg-paper hover:text-ink inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="applying || !code.trim()"
                data-testid="cart-discount-apply"
              >
                {{ t('apply') }}
              </button>
            </div>
            <p v-if="codeError" class="text-accent mt-2 text-xs" data-testid="cart-discount-error">
              {{ codeError }}
            </p>
          </form>
          <dl class="m-0 mt-8">
            <div class="flex justify-between py-2.5">
              <dt>{{ t('subtotal') }}</dt>
              <dd data-testid="cart-subtotal">
                {{ price(totals?.subtotal ?? 0, currency) }}
              </dd>
            </div>
            <div v-if="totals?.discount" class="flex justify-between py-2.5">
              <dt>{{ t('discount') }}</dt>
              <dd data-testid="cart-discount">−{{ price(totals.discount, currency) }}</dd>
            </div>
            <div class="border-ink mt-2 flex justify-between border-t pt-4 pb-2.5 text-sm">
              <dt>{{ t('total') }}</dt>
              <dd data-testid="cart-total">{{ price(totals?.total ?? 0, currency) }}</dd>
            </div>
            <div v-if="totals?.taxAmount" class="text-muted flex justify-between py-2.5">
              <dt>{{ t('vatIncluded') }}</dt>
              <dd>{{ price(totals.taxAmount, currency) }}</dd>
            </div>
          </dl>
          <p class="text-muted mt-3 mb-6 text-xs">{{ t('shippingNote') }}</p>
          <a
            v-if="cartStore.checkoutUrl"
            :href="cartStore.checkoutUrl"
            class="border-ink bg-ink text-paper hover:bg-paper hover:text-ink inline-flex min-h-11 w-full items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150"
            data-testid="cart-checkout"
            >{{ t('checkout') }}</a
          >
        </aside>
      </div>
    </ClientOnly>
  </div>
</template>
