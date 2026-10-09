<script setup lang="ts">
import { cartNoticeMessage } from '~~/shared/utils/customer-prices';

const cartStore = useCartStore();
const { t } = useLocale();
const price = usePrice();
const items = computed(() => cartStore.cart?.items ?? []);
const replacedNotice = computed(() => {
  const message = cartNoticeMessage(cartStore.notice);
  return message ? t(message.key, message.params) : '';
});
</script>

<template>
  <Transition name="drawer">
    <div v-if="cartStore.drawerOpen" class="fixed inset-0 z-40" data-testid="mini-cart">
      <button
        type="button"
        class="absolute inset-0 bg-black/30"
        :aria-label="t('close')"
        @click="cartStore.drawerOpen = false"
      />
      <aside
        class="bg-paper absolute inset-y-0 right-0 flex w-[min(420px,100%)] flex-col p-6"
        role="dialog"
        :aria-label="t('cart')"
      >
        <div class="border-rule flex justify-between border-b pb-5">
          <p class="text-[11px] tracking-[0.14em] uppercase">
            {{ t('cart') }}
            <span v-if="cartStore.count">({{ cartStore.count }})</span>
          </p>
          <button
            type="button"
            class="text-[11px] tracking-[0.14em] uppercase"
            data-testid="mini-cart-close"
            @click="cartStore.drawerOpen = false"
          >
            {{ t('close') }}
          </button>
        </div>
        <p v-if="replacedNotice" class="pt-4 text-xs" role="status" data-testid="mini-cart-notice">
          {{ replacedNotice }}
        </p>
        <p v-if="items.length === 0" class="text-muted pt-6">
          {{ t('emptyCart') }}
        </p>
        <ul v-else class="m-0 flex-1 list-none overflow-y-auto p-0">
          <li
            v-for="item in items"
            :key="item.id"
            class="border-rule flex gap-4 border-b py-4"
            data-testid="mini-cart-item"
          >
            <div class="bg-soft aspect-4/5 w-18 shrink-0">
              <img
                v-if="item.thumbnail?.url"
                :src="item.thumbnail.url"
                :alt="item.title"
                class="h-full w-full object-cover"
              />
            </div>
            <div>
              <p class="text-xs tracking-[0.06em] uppercase">
                {{ item.title }}
              </p>
              <p class="text-muted mt-1 text-xs">
                {{
                  (item.optionSnapshots ?? [])
                    .map((o) => o.optionValueName ?? o.optionValueKey)
                    .join(' · ')
                }}
              </p>
              <p class="mt-1 text-xs">
                {{ item.quantity }} ×
                {{ price(item.price, cartStore.cart?.currency) }}
              </p>
            </div>
          </li>
        </ul>
        <div v-if="items.length" class="grid gap-2.5 pt-5">
          <div class="flex justify-between pb-3">
            <span class="text-[11px] tracking-[0.14em] uppercase">{{ t('total') }}</span>
            <span>{{ price(cartStore.cart?.totals?.total ?? 0, cartStore.cart?.currency) }}</span>
          </div>
          <NuxtLink
            to="/cart"
            class="border-ink bg-ink text-paper hover:bg-paper hover:text-ink inline-flex min-h-11 w-full items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150"
            data-testid="mini-cart-view"
            @click="cartStore.drawerOpen = false"
          >
            {{ t('viewCart') }}
          </NuxtLink>
          <a
            v-if="cartStore.checkoutUrl"
            :href="cartStore.checkoutUrl"
            class="border-ink bg-paper text-ink hover:bg-ink hover:text-paper inline-flex min-h-11 w-full items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150"
            data-testid="mini-cart-checkout"
          >
            {{ t('checkout') }}
          </a>
        </div>
      </aside>
    </div>
  </Transition>
</template>
