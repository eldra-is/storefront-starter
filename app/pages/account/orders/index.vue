<script setup lang="ts">
import type { EldraSalesOrderList } from '@eldrajs/sdk';
import { ORDER_PAGE_SIZE, readRefusal, salesStatusKey } from '~~/shared/utils/sales-orders';

/**
 * The company's orders on account, newest first: every member of the company sees them all. Read
 * on the server through /api/sales-orders (the session cookie is forwarded), never cached.
 */
const { t } = useLocale();
const price = usePrice();
const formatDate = useOrderDate();
const route = useRoute();
const businessLogin = useBusinessLogin();
const pricing = useCustomerPricing();

if (!businessLogin.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' });
}

const page = computed(() => {
  const n = Number(route.query.page);
  return Number.isInteger(n) && n > 0 ? n : 1;
});

const { data, error } = await useFetch<EldraSalesOrderList>('/api/sales-orders', {
  // A key per company and page: one company's orders are never shown for another.
  key: computed(() => `sales-orders:${pricing.value.customerId ?? 'none'}:${page.value}`),
  query: computed(() => ({ page: page.value, pageSize: ORDER_PAGE_SIZE })),
  retry: false,
  onResponse: useForwardCookies(),
});

const status = computed(() => error.value?.statusCode);
// A 403 or 409 says why: choose a company, business login off, or no membership.
const refusal = computed(() =>
  status.value === 403 || status.value === 409 ? readRefusal(error.value) : null
);
const orders = computed(() => data.value?.data ?? []);
const meta = computed(() => data.value?.meta);
const signInHref = `/auth/login?returnTo=${encodeURIComponent('/account/orders')}`;

const button =
  'border-ink bg-paper text-ink hover:bg-ink hover:text-paper inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150';

useSeoMeta({ title: () => t('orders'), robots: 'noindex, nofollow' });
</script>

<template>
  <div class="px-[clamp(16px,4vw,48px)] py-16" data-testid="sales-orders">
    <p class="text-[11px] tracking-[0.14em] uppercase">
      <NuxtLink to="/account" class="border-b border-current">{{ t('account') }}</NuxtLink>
    </p>
    <h1
      class="mt-4 text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase"
    >
      {{ t('orders') }}
    </h1>

    <div v-if="status === 401" class="mt-8 grid justify-items-start gap-6">
      <p class="text-muted">{{ t('signInIntro') }}</p>
      <a :href="signInHref" :class="button" data-testid="sales-orders-sign-in">{{ t('signIn') }}</a>
    </div>

    <div v-else-if="refusal" class="mt-8 grid justify-items-start gap-6">
      <p class="text-muted" role="alert" data-testid="sales-orders-refusal">
        {{ t(refusal.message) }}
      </p>
      <a v-if="refusal.linkToAccount" href="/account" :class="button">{{ t('account') }}</a>
    </div>

    <p v-else-if="error" class="text-muted mt-8" role="alert" data-testid="sales-orders-error">
      {{ t('ordersError') }}
    </p>

    <p v-else-if="orders.length === 0" class="text-muted mt-8" data-testid="sales-orders-empty">
      {{ t('noOrders') }}
    </p>

    <template v-else>
      <table class="mt-10 w-full border-collapse text-left text-sm" data-testid="sales-orders-list">
        <thead>
          <tr class="border-ink border-b text-[11px] tracking-[0.14em] uppercase">
            <th class="py-3 pr-4 font-normal">{{ t('orderNumber') }}</th>
            <th class="py-3 pr-4 font-normal">{{ t('placedAt') }}</th>
            <th class="py-3 pr-4 font-normal max-[700px]:hidden">{{ t('purchaseOrderNumber') }}</th>
            <th class="py-3 pr-4 font-normal">{{ t('status') }}</th>
            <th class="py-3 pr-4 font-normal max-[700px]:hidden">{{ t('backorder') }}</th>
            <th class="py-3 text-right font-normal">{{ t('total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="order in orders"
            :key="order.id"
            class="border-rule border-b"
            :data-testid="`sales-order-row-${order.id}`"
          >
            <td class="py-4 pr-4">
              <NuxtLink
                :to="`/account/orders/${order.id}`"
                class="border-b border-current"
                data-testid="sales-order-link"
                >{{ order.orderNumber }}</NuxtLink
              >
            </td>
            <td class="py-4 pr-4">{{ formatDate(order.placedAt) }}</td>
            <td class="py-4 pr-4 max-[700px]:hidden">{{ order.purchaseOrderNumber || '—' }}</td>
            <td class="py-4 pr-4" data-testid="sales-order-status">
              {{ t(salesStatusKey(order.salesStatus)) }}
            </td>
            <td class="py-4 pr-4 max-[700px]:hidden">{{ order.backorderQuantity || '—' }}</td>
            <td class="py-4 text-right">{{ price(order.totalAmount, order.currency) }}</td>
          </tr>
        </tbody>
      </table>
      <nav
        v-if="meta && (meta.hasPrev || meta.hasNext)"
        class="mt-8 flex gap-3"
        :aria-label="t('orders')"
      >
        <NuxtLink
          v-if="meta.hasPrev"
          :to="{ query: { page: page - 1 } }"
          :class="button"
          data-testid="sales-orders-prev"
          >{{ t('previousPage') }}</NuxtLink
        >
        <NuxtLink
          v-if="meta.hasNext"
          :to="{ query: { page: page + 1 } }"
          :class="button"
          data-testid="sales-orders-next"
          >{{ t('nextPage') }}</NuxtLink
        >
      </nav>
    </template>
  </div>
</template>
