<script setup lang="ts">
import type { EldraCustomerLocation, EldraSalesOrder, EldraSalesOrderPreview } from '@eldrajs/sdk';
import { DEFAULT_RETURN_TO } from '~~/shared/utils/auth';
import {
  NOTE_MAX_LENGTH,
  PO_NUMBER_MAX_LENGTH,
  attemptFingerprint,
  companyGoneMessage,
  createPreviewSequence,
  latestAnswer,
  refreshesPreview,
  salesOrderRefusal,
  type CheckoutForm,
} from '~~/shared/utils/sales-orders';

/**
 * Order on account: a signed-in business customer places the company's cart as a sales order. The
 * supplier invoices the company later, so there is no payment step. Prices, totals and the credit
 * check come from the server's preview (the cart page shows the prices stored when each line was
 * added; the order is priced at the company's current terms).
 */
const { t } = useLocale();
const price = usePrice();
const businessLogin = useBusinessLogin();
const pricing = useCustomerPricing();
const cartStore = useCartStore();
const salesOrders = useSalesOrders();

if (!businessLogin.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' });
}

const signInHref = `/auth/login?returnTo=${encodeURIComponent('/checkout/account')}`;
// A full page load: /account reads the session on the server.
const accountHref = DEFAULT_RETURN_TO;

const form = reactive<CheckoutForm>({
  locationId: '',
  purchaseOrderNumber: '',
  customerOrderDate: '',
  note: '',
});
const locations = ref<EldraCustomerLocation[]>([]);
const preview = ref<EldraSalesOrderPreview | null>(null);
const placed = ref<EldraSalesOrder | null>(null);
const ready = ref(false);
/** True while any preview is on its way, so Place order and the location wait for it. */
const previewing = ref(false);
const previews = createPreviewSequence();
const placing = ref(false);
/** The message (and what it is about) of the last refusal. */
const problem = ref<{ message: string; action: string } | null>(null);

const cartLines = computed(() => cartStore.cart?.items ?? []);

function messageFor(refusal: ReturnType<typeof salesOrderRefusal>): string {
  if (refusal.action === 'open-order') return '';
  const titleOf = (variantId: string) =>
    cartLines.value.find((line) => line.variantId === variantId)?.title;
  if (refusal.message === 'salesOrderLineInvalid' && refusal.variantId) {
    const item = titleOf(refusal.variantId);
    if (item) return t('salesOrderLineInvalidNamed', { item });
  }
  if (refusal.message === 'salesOrderProductUnavailable' && refusal.variantIds?.length) {
    const items = refusal.variantIds.map(titleOf).filter(Boolean);
    if (items.length) return t('salesOrderProductUnavailableNamed', { items: items.join(', ') });
  }
  return t(refusal.message);
}

async function loadLocations() {
  locations.value = await salesOrders.locations();
  const keep = locations.value.some((l) => l.id === form.locationId);
  if (!keep) {
    form.locationId = (locations.value.find((l) => l.isDefault) ?? locations.value[0])?.id ?? '';
  }
}

/** Acts on a refused preview or create (see `salesOrderRefusal`). */
async function handleRefusal(error: unknown) {
  const refusal = salesOrderRefusal(error);
  if (refusal.action === 'open-order') {
    // The cart already became that order: it is gone, so the basket starts afresh.
    cartStore.forgetCart();
    await navigateTo(`/account/orders/${encodeURIComponent(refusal.salesOrderId)}?already=1`);
    return;
  }
  problem.value = { message: messageFor(refusal), action: refusal.action };
  if (refusal.action === 'to-guest' || refusal.action === 'choose-company') {
    // The server ended the session or dropped the company: the cart follows who is buying now
    // (a guest cart at list prices, or it waits for the person to choose a company).
    preview.value = null;
    await salesOrders.refreshPricing();
    // Now that who is buying is known again, say what happened: choose another company, or
    // the cart is at list prices.
    problem.value = {
      message: t(companyGoneMessage(refusal.message, pricing.value)),
      action: refusal.action,
    };
    await cartStore.loadCart();
  } else if (refusal.action === 'sign-in') {
    preview.value = null;
    pricing.value = { ...pricing.value, signedIn: false };
  } else if (refusal.action === 'rebind') {
    preview.value = null;
    if (await cartStore.rebindCart()) await runPreview(false);
  } else if (refusal.action === 'reload-locations') {
    await loadLocations().catch(() => undefined);
    await runPreview(false);
  } else if (refreshesPreview(refusal)) {
    // A credit or blocked refusal: the preview's wouldBlock (or its own refusal) now decides
    // whether placing is offered, rather than leaving the button on for a retry that cannot pass.
    await runPreview(false);
  }
}

async function runPreview(clear = true) {
  if (!cartStore.cartId || !cartStore.accountOrderAllowed) {
    preview.value = null;
    return;
  }
  if (clear) problem.value = null;
  const input = {
    cartId: cartStore.cartId,
    ...(form.locationId ? { locationId: form.locationId } : {}),
  };
  const answer = latestAnswer(previews, () => salesOrders.preview(input));
  previewing.value = previews.loading;
  const settled = await answer;
  previewing.value = previews.loading;
  // An older preview (another location) answering late is dropped, answer and refusal alike.
  if (!settled.latest) return;
  if ('error' in settled) {
    preview.value = null;
    await handleRefusal(settled.error);
    return;
  }
  preview.value = settled.value ?? null;
}

const credit = computed(() => preview.value?.credit);
const blocked = computed(() => credit.value?.wouldBlock === true);
const creditOver = computed(() => credit.value?.status === 'OVER' && !blocked.value);
const backordered = computed(() =>
  (preview.value?.lines ?? []).some(
    (line) => typeof line.availableNow === 'number' && line.availableNow < line.quantity
  )
);
const canPlace = computed(
  () => Boolean(preview.value) && !blocked.value && !placing.value && !previewing.value
);

async function placeOrder() {
  if (!canPlace.value || !cartStore.cartId) return;
  placing.value = true;
  problem.value = null;
  const fingerprint = attemptFingerprint({
    cartId: cartStore.cartId,
    cartVersion: cartStore.cart?.version,
    form,
  });
  try {
    placed.value = await salesOrders.place(
      {
        cartId: cartStore.cartId,
        ...(form.locationId ? { locationId: form.locationId } : {}),
        ...(form.purchaseOrderNumber.trim()
          ? { purchaseOrderNumber: form.purchaseOrderNumber.trim() }
          : {}),
        ...(form.customerOrderDate ? { customerOrderDate: form.customerOrderDate } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      },
      fingerprint
    );
    // The supplier removes the cart once the order is placed: start a new one for the next order.
    cartStore.forgetCart();
  } catch (error) {
    await handleRefusal(error);
  } finally {
    placing.value = false;
  }
}

onMounted(async () => {
  try {
    await cartStore.loadCart();
    if (!cartStore.accountOrderAllowed) return;
    try {
      await loadLocations();
    } catch (error) {
      await handleRefusal(error);
      return;
    }
    await runPreview();
  } finally {
    ready.value = true;
  }
});

watch(
  () => form.locationId,
  (next, previous) => {
    if (ready.value && next !== previous) void runPreview();
  }
);

const input =
  'border-ink bg-paper focus:ring-ink min-h-11 w-full min-w-0 border px-3 outline-none focus:ring-1';
const primary =
  'border-ink bg-ink text-paper hover:bg-paper hover:text-ink inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40';
const secondary =
  'border-ink bg-paper text-ink hover:bg-ink hover:text-paper inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150';

useSeoMeta({ title: () => t('orderOnAccount'), robots: 'noindex, nofollow' });
</script>

<template>
  <div class="px-[clamp(16px,4vw,48px)] py-16" data-testid="account-checkout">
    <h1 class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase">
      {{ t('orderOnAccount') }}
    </h1>
    <ClientOnly>
      <section
        v-if="placed"
        class="mt-10 grid max-w-2xl gap-4"
        data-testid="sales-order-confirmation"
      >
        <p class="text-lg" role="status">
          {{ t('orderPlaced', { number: placed.orderNumber }) }}
        </p>
        <p
          v-if="placed.warnings?.length"
          class="text-muted text-sm"
          data-testid="sales-order-warnings"
        >
          {{ t('orderPlacedFollowUp') }}
        </p>
        <div class="flex flex-wrap gap-3">
          <NuxtLink
            :to="`/account/orders/${placed.id}`"
            :class="primary"
            data-testid="sales-order-view"
            >{{ t('viewOrder') }}</NuxtLink
          >
          <NuxtLink to="/shop" :class="secondary">{{ t('continueShopping') }}</NuxtLink>
        </div>
      </section>

      <div v-else-if="!pricing.signedIn" class="mt-8 grid justify-items-start gap-6">
        <p v-if="problem" class="text-accent text-xs" role="alert" data-testid="sales-order-error">
          {{ problem.message }}
        </p>
        <p class="text-muted">{{ t('signInToOrder') }}</p>
        <a :href="signInHref" :class="secondary" data-testid="account-checkout-sign-in">{{
          t('signIn')
        }}</a>
      </div>

      <div
        v-else-if="pricing.needsCompany || !pricing.customerId"
        class="mt-8 grid justify-items-start gap-6"
      >
        <p v-if="problem" class="text-accent text-xs" role="alert" data-testid="sales-order-error">
          {{ problem.message }}
        </p>
        <p class="text-muted">{{ t('companyRequired') }}</p>
        <a :href="accountHref" :class="secondary">{{ t('account') }}</a>
      </div>

      <p v-else-if="!ready" class="text-muted mt-8">…</p>

      <div
        v-else-if="!cartStore.accountOrderAllowed"
        class="mt-8 grid justify-items-start gap-6"
        data-testid="account-checkout-unavailable"
      >
        <p v-if="problem" class="text-accent text-xs" role="alert" data-testid="sales-order-error">
          {{ problem.message }}
        </p>
        <p class="text-muted">
          {{ cartLines.length === 0 ? t('emptyCart') : t('orderOnAccountUnavailable') }}
        </p>
        <NuxtLink to="/cart" :class="secondary">{{ t('viewCart') }}</NuxtLink>
      </div>

      <form
        v-else
        class="mt-10 grid gap-12 min-[900px]:grid-cols-[7fr_4fr] min-[900px]:gap-16"
        data-testid="account-checkout-form"
        @submit.prevent="placeOrder"
      >
        <div class="grid content-start gap-6">
          <p class="text-muted text-sm">
            {{ t('orderOnAccountIntro') }}
          </p>

          <div>
            <label class="mb-2.5 block text-[11px] tracking-[0.14em] uppercase" for="so-location">
              {{ t('deliveryLocation') }}
            </label>
            <select
              v-if="locations.length"
              id="so-location"
              v-model="form.locationId"
              :class="input"
              :disabled="previewing || placing"
              data-testid="sales-order-location"
            >
              <option v-for="location in locations" :key="location.id" :value="location.id">
                {{ location.name }} — {{ location.addressLine1 }}, {{ location.postalCode }}
                {{ location.city }}
              </option>
            </select>
            <p v-else class="text-muted text-sm" data-testid="sales-order-location-none">
              {{ t('deliveryLocationNone') }}
            </p>
          </div>

          <div class="grid gap-6 min-[600px]:grid-cols-2">
            <div>
              <label class="mb-2.5 block text-[11px] tracking-[0.14em] uppercase" for="so-po">
                {{ t('purchaseOrderNumber') }}
              </label>
              <input
                id="so-po"
                v-model="form.purchaseOrderNumber"
                :maxlength="PO_NUMBER_MAX_LENGTH"
                :class="input"
                autocomplete="off"
                data-testid="sales-order-po"
              />
            </div>
            <div>
              <label class="mb-2.5 block text-[11px] tracking-[0.14em] uppercase" for="so-date">
                {{ t('customerOrderDate') }}
              </label>
              <input
                id="so-date"
                v-model="form.customerOrderDate"
                type="date"
                :class="input"
                data-testid="sales-order-date"
              />
            </div>
          </div>

          <div>
            <label class="mb-2.5 block text-[11px] tracking-[0.14em] uppercase" for="so-note">
              {{ t('orderNote') }}
            </label>
            <textarea
              id="so-note"
              v-model="form.note"
              :maxlength="NOTE_MAX_LENGTH"
              rows="4"
              :class="[input, 'py-2']"
              aria-describedby="so-note-hint"
              data-testid="sales-order-note"
            />
            <p id="so-note-hint" class="text-muted mt-2 text-xs">{{ t('orderNoteHint') }}</p>
          </div>

          <ul
            v-if="preview"
            class="border-rule m-0 list-none border-t p-0"
            data-testid="sales-order-preview-lines"
          >
            <li
              v-for="line in preview.lines"
              :key="line.variantId"
              class="border-rule grid grid-cols-[1fr_auto] gap-4 border-b py-4"
              :data-testid="`sales-order-preview-line-${line.variantId}`"
            >
              <div>
                <p class="text-xs tracking-[0.06em] uppercase">{{ line.title }}</p>
                <p class="text-muted mt-1 text-xs">
                  {{ t('quantity') }}: {{ line.quantity }} · {{ line.sku }}
                </p>
                <p
                  v-if="typeof line.availableNow === 'number' && line.availableNow < line.quantity"
                  class="text-muted mt-1 text-xs"
                  data-testid="sales-order-line-backorder"
                >
                  {{ t('salesOrderLineBackorder', { available: Math.max(line.availableNow, 0) }) }}
                </p>
              </div>
              <p class="text-[13px]">{{ price(line.finalPrice, preview.currency) }}</p>
            </li>
          </ul>
        </div>

        <aside class="sticky top-[calc(var(--header-h)+24px)] grid content-start gap-4 self-start">
          <p v-if="previewing && !preview" class="text-muted">…</p>
          <template v-if="preview">
            <dl class="m-0" data-testid="sales-order-preview">
              <div class="flex justify-between py-2.5">
                <dt>{{ t('subtotal') }}</dt>
                <dd>{{ price(preview.subtotalAmount, preview.currency) }}</dd>
              </div>
              <div class="border-ink mt-2 flex justify-between border-t pt-4 pb-2.5 text-sm">
                <dt>{{ t('total') }}</dt>
                <dd data-testid="sales-order-total">
                  {{ price(preview.totalAmount, preview.currency) }}
                </dd>
              </div>
              <div v-if="preview.taxAmount" class="text-muted flex justify-between py-2.5">
                <dt>{{ t('vatIncluded') }}</dt>
                <dd>{{ price(preview.taxAmount, preview.currency) }}</dd>
              </div>
              <div class="flex justify-between gap-4 py-2.5 text-sm">
                <dt>{{ t('paymentTerm') }}</dt>
                <dd data-testid="sales-order-payment-term">
                  {{ preview.paymentTermLabel || '—' }}
                </dd>
              </div>
            </dl>
            <div class="text-sm" data-testid="sales-order-delivery">
              <p class="text-[11px] tracking-[0.14em] uppercase">{{ t('deliverTo') }}</p>
              <p class="mt-2">{{ preview.delivery.name }}</p>
              <p class="text-muted">
                {{ preview.delivery.address }}, {{ preview.delivery.postalCode }}
                {{ preview.delivery.town }}
              </p>
            </div>
            <p v-if="backordered" class="text-muted text-xs" data-testid="sales-order-backorder">
              {{ t('salesOrderBackorderNotice') }}
            </p>
            <p
              v-if="blocked"
              class="text-accent text-xs"
              role="alert"
              data-testid="sales-order-credit"
            >
              {{ t('salesOrderCreditLimit') }}
            </p>
            <p v-else-if="creditOver" class="text-muted text-xs" data-testid="sales-order-credit">
              {{ t('salesOrderCreditOver') }}
            </p>
          </template>
          <p
            v-if="problem"
            class="text-accent text-xs"
            role="alert"
            data-testid="sales-order-error"
          >
            {{ problem.message }}
            <a
              v-if="problem.action === 'sign-in'"
              :href="signInHref"
              class="border-b border-current"
              >{{ t('signIn') }}</a
            >
          </p>
          <button
            v-if="!preview && !previewing"
            type="button"
            :class="[secondary, 'w-full']"
            data-testid="sales-order-preview-again"
            @click="runPreview()"
          >
            {{ t('tryAgain') }}
          </button>
          <button
            type="submit"
            :class="[primary, 'w-full']"
            :disabled="!canPlace"
            data-testid="sales-order-place"
          >
            {{ placing ? t('placingOrder') : t('placeOrder') }}
          </button>
          <p class="text-muted text-xs">{{ t('orderOnAccountTerms') }}</p>
        </aside>
      </form>
    </ClientOnly>
  </div>
</template>
