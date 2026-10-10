import type {
  EldraCreateSalesOrderInput,
  EldraCustomerLocation,
  EldraCustomerLocationList,
  EldraSalesOrder,
  EldraSalesOrderPreview,
  EldraSalesOrderPreviewInput,
} from '@eldrajs/sdk';
import { SIGNED_OUT_PRICING, type CustomerPricingState } from '~~/shared/utils/customer-prices';
import {
  CHECKOUT_ATTEMPT_KEY,
  attemptAfter,
  attemptFor,
  readAttempt,
  reorderLines,
  type CheckoutAttempt,
} from '~~/shared/utils/sales-orders';

/** Session storage, or null where there is none (the server, a locked-down browser). */
function attemptStore(): Storage | null {
  try {
    return import.meta.client ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function loadAttempt(): CheckoutAttempt | null {
  try {
    return readAttempt(attemptStore()?.getItem(CHECKOUT_ATTEMPT_KEY));
  } catch {
    return null;
  }
}

function saveAttempt(attempt: CheckoutAttempt | null) {
  try {
    const store = attemptStore();
    if (attempt) store?.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify(attempt));
    else store?.removeItem(CHECKOUT_ATTEMPT_KEY);
  } catch {
    // Storage full or blocked: the attempt then lives only as long as this page.
  }
}

/** A random key: a UUID where the browser has one (secure contexts), else 128 random bits in hex. */
function mintKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Orders on account for a signed-in business customer, through this site's server routes (they add
 * the token and the active company; the browser never holds either). The `Idempotency-Key` of a
 * checkout attempt is kept in session storage: the same key while the cart and the form are
 * unchanged and the last answer may follow a placed order, a new one otherwise.
 */
export function useSalesOrders() {
  const cartStore = useCartStore();
  const pricing = useCustomerPricing();
  let inMemory: CheckoutAttempt | null = null;

  async function locations(): Promise<EldraCustomerLocation[]> {
    const list = await $fetch<EldraCustomerLocationList>('/api/customer/locations');
    return list?.data ?? [];
  }

  function preview(input: EldraSalesOrderPreviewInput): Promise<EldraSalesOrderPreview> {
    return $fetch<EldraSalesOrderPreview>('/api/sales-orders/preview', {
      method: 'POST',
      body: input,
    });
  }

  /** Places the order; `fingerprint` (attemptFingerprint) says what the key is minted for. */
  async function place(
    input: EldraCreateSalesOrderInput,
    fingerprint: string
  ): Promise<EldraSalesOrder> {
    const attempt = attemptFor(loadAttempt() ?? inMemory, fingerprint, mintKey);
    inMemory = attempt;
    saveAttempt(attempt);
    try {
      const order = await $fetch<EldraSalesOrder>('/api/sales-orders', {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': attempt.key },
      });
      inMemory = null;
      saveAttempt(null);
      return order;
    } catch (error) {
      inMemory = attemptAfter(attempt, error);
      saveAttempt(inMemory);
      throw error;
    }
  }

  /** Re-reads who is buying from the server session (after it ended or dropped the company). */
  async function refreshPricing(): Promise<void> {
    try {
      pricing.value = {
        ...SIGNED_OUT_PRICING,
        ...(await $fetch<CustomerPricingState>('/api/auth/pricing')),
      };
    } catch {
      // Unknown: keep what the page has; the next call decides again.
    }
  }

  /**
   * Adds an order's lines to the cart at the quantities ordered, through the cart store (signed in,
   * so through the cart routes, priced at today's terms). Answers how many lines could not be added.
   */
  async function orderAgain(order: Pick<EldraSalesOrder, 'lines'>): Promise<{ missing: number }> {
    const { lines, skipped } = reorderLines(order);
    let missing = skipped;
    for (const line of lines) {
      try {
        await cartStore.addItem(line.productId, line.variantId, line.quantity);
      } catch {
        missing += 1;
      }
    }
    cartStore.drawerOpen = false;
    return { missing };
  }

  return { locations, preview, place, refreshPricing, orderAgain };
}

/** A date or date-time from the gateway in the visitor's language. */
export function useOrderDate() {
  const { locale } = useLocale();
  return (value: string | null | undefined, withTime = false): string => {
    if (!value) return '—';
    // A plain date is the buyer's own (no time zone): show it as written, not shifted.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00Z`)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' } : {}),
      timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : undefined,
    }).format(date);
  };
}
