<script setup lang="ts">
import type { EldraSalesOrder } from '@eldrajs/sdk';
import { placedByLabel, salesStatusKey } from '~~/shared/utils/sales-orders';

/**
 * One of the company's orders on account: status, delivery, and each line's ordered, delivered and
 * backordered quantity with what is in stock now. "Order again" adds the lines to the cart at the
 * quantities ordered, priced at today's terms. Read on the server, never cached.
 */
const { t } = useLocale();
const price = usePrice();
const formatDate = useOrderDate();
const route = useRoute();
const businessLogin = useBusinessLogin();
const pricing = useCustomerPricing();
const salesOrders = useSalesOrders();

if (!businessLogin.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' });
}

const id = computed(() => String(route.params.id ?? ''));
const { data: order, error } = await useFetch<EldraSalesOrder>(
  () => `/api/sales-orders/${encodeURIComponent(id.value)}`,
  {
    key: computed(() => `sales-order:${pricing.value.customerId ?? 'none'}:${id.value}`),
    retry: false,
    onResponse: useForwardCookies(),
  }
);

const status = computed(() => error.value?.statusCode);
const alreadyOrdered = computed(() => route.query.already === '1');
const signInHref = computed(
  () => `/auth/login?returnTo=${encodeURIComponent(`/account/orders/${id.value}`)}`
);

const reordering = ref(false);
const reorderMessage = ref('');

async function orderAgain() {
  if (!order.value) return;
  reordering.value = true;
  reorderMessage.value = '';
  try {
    const { missing } = await salesOrders.orderAgain(order.value);
    // Every line added: on to the cart. Otherwise say how many could not be, and link to the cart.
    if (missing > 0) reorderMessage.value = t('orderAgainMissing', { missing });
    else await navigateTo('/cart');
  } finally {
    reordering.value = false;
  }
}

const button =
  'border-ink bg-paper text-ink hover:bg-ink hover:text-paper inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40';

useSeoMeta({
  title: () => (order.value ? `${t('order')} ${order.value.orderNumber}` : t('orders')),
  robots: 'noindex, nofollow',
});
</script>

<template>
  <div class="px-[clamp(16px,4vw,48px)] py-16" data-testid="sales-order">
    <p class="text-[11px] tracking-[0.14em] uppercase">
      <NuxtLink to="/account/orders" class="border-b border-current">{{ t('orders') }}</NuxtLink>
    </p>

    <div v-if="status === 401" class="mt-8 grid justify-items-start gap-6">
      <p class="text-muted">{{ t('signInIntro') }}</p>
      <a :href="signInHref" :class="button">{{ t('signIn') }}</a>
    </div>

    <p v-else-if="status === 404" class="text-muted mt-8" data-testid="sales-order-not-found">
      {{ t('orderNotFound') }}
    </p>

    <div v-else-if="status === 409 || status === 403" class="mt-8 grid justify-items-start gap-6">
      <p class="text-muted">{{ t('companyRequired') }}</p>
      <a href="/account" :class="button">{{ t('account') }}</a>
    </div>

    <p v-else-if="error || !order" class="text-muted mt-8" role="alert">{{ t('ordersError') }}</p>

    <template v-else>
      <h1
        class="mt-4 text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase"
        data-testid="sales-order-number"
      >
        {{ t('order') }} {{ order.orderNumber }}
      </h1>
      <p v-if="alreadyOrdered" class="mt-4 text-sm" role="status" data-testid="sales-order-already">
        {{ t('salesOrderAlreadyOrdered') }}
      </p>

      <dl class="mt-8 grid max-w-3xl gap-x-8 gap-y-3 text-sm min-[700px]:grid-cols-2">
        <div>
          <dt class="text-muted">{{ t('status') }}</dt>
          <dd data-testid="sales-order-detail-status">
            {{ t(salesStatusKey(order.salesStatus)) }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('placedAt') }}</dt>
          <dd>{{ formatDate(order.placedAt, true) }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('placedBy') }}</dt>
          <dd>{{ placedByLabel(order.placedByName) }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('purchaseOrderNumber') }}</dt>
          <dd>{{ order.purchaseOrderNumber || '—' }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('customerOrderDate') }}</dt>
          <dd>{{ formatDate(order.customerOrderDate) }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('paymentTerm') }}</dt>
          <dd>{{ order.paymentTermLabel || '—' }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('deliverTo') }}</dt>
          <dd>
            {{ order.delivery.name }}<br />
            {{ order.delivery.address }}, {{ order.delivery.postalCode }} {{ order.delivery.town }}
          </dd>
        </div>
        <div v-if="order.note">
          <dt class="text-muted">{{ t('orderNote') }}</dt>
          <dd class="whitespace-pre-line">{{ order.note }}</dd>
        </div>
      </dl>

      <div class="mt-10 overflow-x-auto">
        <table class="w-full border-collapse text-left text-sm" data-testid="sales-order-lines">
          <thead>
            <tr class="border-ink border-b text-[11px] tracking-[0.14em] uppercase">
              <th class="py-3 pr-4 font-normal">{{ t('item') }}</th>
              <th class="py-3 pr-4 text-right font-normal">{{ t('ordered') }}</th>
              <th class="py-3 pr-4 text-right font-normal">{{ t('delivered') }}</th>
              <th class="py-3 pr-4 text-right font-normal">{{ t('backorder') }}</th>
              <th class="py-3 pr-4 text-right font-normal">{{ t('inStockNow') }}</th>
              <th class="py-3 text-right font-normal">{{ t('total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="line in order.lines"
              :key="line.lineId"
              class="border-rule border-b"
              :data-testid="`sales-order-line-${line.lineId}`"
            >
              <td class="py-4 pr-4">
                <span class="text-xs tracking-[0.06em] uppercase">{{ line.title }}</span>
                <span class="text-muted block text-xs">{{ line.sku }}</span>
              </td>
              <td class="py-4 pr-4 text-right">{{ line.quantity }}</td>
              <td class="py-4 pr-4 text-right">{{ line.quantityDelivered }}</td>
              <td class="py-4 pr-4 text-right">{{ line.backorder }}</td>
              <td class="py-4 pr-4 text-right">{{ line.backorder > 0 ? line.inStockNow : '—' }}</td>
              <td class="py-4 text-right">{{ price(line.finalPrice, order.currency) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl class="mt-6 ml-auto max-w-sm text-sm">
        <div class="flex justify-between py-2">
          <dt>{{ t('subtotal') }}</dt>
          <dd>{{ price(order.subtotalAmount, order.currency) }}</dd>
        </div>
        <div class="border-ink flex justify-between border-t pt-3 pb-2">
          <dt>{{ t('total') }}</dt>
          <dd data-testid="sales-order-detail-total">
            {{ price(order.totalAmount, order.currency) }}
          </dd>
        </div>
        <div v-if="order.taxAmount" class="text-muted flex justify-between py-2">
          <dt>{{ t('vatIncluded') }}</dt>
          <dd>{{ price(order.taxAmount, order.currency) }}</dd>
        </div>
      </dl>

      <ClientOnly>
        <div class="mt-10 grid justify-items-start gap-3">
          <button
            type="button"
            :class="button"
            :disabled="reordering"
            data-testid="sales-order-again"
            @click="orderAgain"
          >
            {{ t('orderAgain') }}
          </button>
          <p class="text-muted text-xs">{{ t('orderAgainHint') }}</p>
          <p v-if="reorderMessage" class="text-accent text-xs" role="alert">
            {{ reorderMessage }}
            <NuxtLink to="/cart" class="border-b border-current">{{ t('viewCart') }}</NuxtLink>
          </p>
        </div>
      </ClientOnly>
    </template>
  </div>
</template>
