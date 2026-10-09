import { defineStore, skipHydrate } from 'pinia';
import { computed, ref } from 'vue';
import { createCartSession } from '@eldrajs/sdk';
import type { EldraCart } from '@eldrajs/sdk';
import { cartRefusal, type CartRefusal } from '~~/shared/utils/customer-prices';

/** Starter-prefixed so a site never picks up a cart id another storefront left on the same origin. */
const CART_STORAGE_KEY = 'storefront-starter.cartId';

/**
 * A guest's cart calls go from the browser to the gateway. A signed-in business customer's writes go
 * through server/api/cart, which adds their token and company, so the cart is bound to the company
 * and priced for it; reads by cart id stay direct (they are open, for hosted checkout too).
 */
export const useCartStore = defineStore('cart', () => {
  const eldra = useEldraClient();
  const { locale } = useLocale();
  const pricing = useCustomerPricing();
  const viaServer = () => pricing.value.signedIn;
  const session = createCartSession({
    storage: import.meta.client ? undefined : null,
    key: CART_STORAGE_KEY,
  });

  // Client-local state; without skipHydrate the server's null would overwrite the restored id.
  const cartId = skipHydrate(ref<string | null>(session.read()));
  const cart = ref<EldraCart | null>(null);
  const lastError = ref<string | null>(null);
  /** Why the cart was replaced by a new one, to tell the person; cleared on the next change. */
  const notice = ref<CartRefusal>(null);
  const drawerOpen = ref(false);

  const count = computed(
    () => cart.value?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0
  );
  // handoffUrl throws when a non-production gateway has no checkout origin configured.
  const checkoutUrl = computed(() => {
    if (!cartId.value) return null;
    try {
      return eldra.checkout.handoffUrl({ cartId: cartId.value, locale: locale.value });
    } catch {
      return null;
    }
  });

  function forgetCart() {
    cartId.value = null;
    cart.value = null;
    session.forget();
  }

  async function loadCart(): Promise<void> {
    if (!cartId.value) return;
    try {
      cart.value = await eldra.cart.get(cartId.value, { locale: locale.value });
    } catch (err) {
      // Reading the cart by id: any not-found answer can only mean the cart.
      if (isNotFound(err)) forgetCart();
    }
  }

  /** Forgets the stored cart when a failed mutation means the server no longer has it. */
  async function forgetIfGone(err: unknown): Promise<boolean> {
    const id = cartId.value;
    if (!id) return false;
    const gone = await isCartGone(err, () => eldra.cart.get(id, { locale: locale.value }));
    if (gone && cartId.value === id) forgetCart();
    return gone;
  }

  /**
   * A refused write that means this cart can never take the person's changes: it is bound to
   * another company (they switched), or to a company while they are no longer signed in. The cart is
   * forgotten so the next add starts a new one, and the reason is kept to say so.
   */
  function replaceIfBound(err: unknown): boolean {
    const refusal = cartRefusal(errorIdOf(err));
    if (refusal !== 'new-cart-other-company' && refusal !== 'new-cart-sign-in') return false;
    forgetCart();
    notice.value = refusal;
    return true;
  }

  /** Remembers what a refused write means for the person (stock, prices, company), for the pages. */
  function noteRefusal(err: unknown) {
    const refusal = cartRefusal(errorIdOf(err));
    if (refusal === 'out-of-stock') lastError.value = 'INSUFFICIENT_STOCK';
    else if (refusal === 'company-required') lastError.value = 'COMPANY_REQUIRED';
    else if (refusal === 'prices-unavailable') lastError.value = 'PRICES_UNAVAILABLE';
    else if (refusal === 'discount-not-for-customer-prices')
      lastError.value = 'DISCOUNT_NOT_FOR_CUSTOMER_PRICES';
  }

  async function addItem(
    productId: string,
    variantId: string,
    quantity: number,
    retried = false
  ): Promise<void> {
    lastError.value = null;
    if (!retried) notice.value = null;
    const input = {
      productId,
      variantId,
      quantity,
      ...(cartId.value ? { cartId: cartId.value } : {}),
    };
    let result: EldraCart;
    try {
      result = viaServer()
        ? await $fetch<EldraCart>('/api/cart/items', { method: 'POST', body: input })
        : await eldra.cart.addItem(input);
    } catch (err) {
      // The server refuses an unknown cart id rather than reviving it; start a fresh cart, once.
      // A missing product or variant also answers not found, so the cart is only dropped when gone.
      // A cart bound to another company (or needing a sign-in) is replaced the same way.
      if (!retried && (replaceIfBound(err) || (await forgetIfGone(err)))) {
        return addItem(productId, variantId, quantity, true);
      }
      noteRefusal(err);
      throw err;
    }
    if (result?.id) {
      cartId.value = result.id;
      session.remember(result.id);
    }
    await loadCart();
    drawerOpen.value = true;
  }

  /** Runs a mutation on the stored cart; a failure that means the cart is gone forgets it, then rethrows. */
  async function mutate(run: (id: string) => Promise<unknown>): Promise<void> {
    if (!cartId.value) return;
    lastError.value = null;
    notice.value = null;
    try {
      await run(cartId.value);
    } catch (err) {
      if (!replaceIfBound(err)) await forgetIfGone(err);
      noteRefusal(err);
      throw err;
    }
  }

  const itemPath = (id: string, itemId: string) =>
    `/api/cart/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`;

  // Mutations answer with the unlocalised cart, so state is always set by the localised read.
  async function updateQuantity(itemId: string, quantity: number): Promise<void> {
    await mutate((id) =>
      viaServer()
        ? $fetch(itemPath(id, itemId), { method: 'PATCH', body: { quantity } })
        : eldra.cart.updateItem(id, itemId, { quantity })
    );
    await loadCart();
  }

  async function removeItem(itemId: string): Promise<void> {
    await mutate((id) =>
      viaServer()
        ? $fetch(itemPath(id, itemId), { method: 'DELETE' })
        : eldra.cart.removeItem(id, itemId)
    );
    await loadCart();
  }

  /** Discount codes do not combine with customer prices: a business customer's cart takes none. */
  const discountAllowed = computed(() => !pricing.value.signedIn);

  async function applyDiscount(code: string): Promise<boolean> {
    if (!cartId.value || !code.trim()) return false;
    lastError.value = null;
    if (!discountAllowed.value) {
      lastError.value = 'DISCOUNT_NOT_FOR_CUSTOMER_PRICES';
      return false;
    }
    try {
      const { cart: repriced, applied } = await eldra.cart.applyDiscount(cartId.value, code, {
        locale: locale.value,
      });
      cart.value = repriced;
      if (!applied) lastError.value = 'DISCOUNT_REJECTED';
      return applied;
    } catch (err) {
      lastError.value =
        cartRefusal(errorIdOf(err)) === 'discount-not-for-customer-prices'
          ? 'DISCOUNT_NOT_FOR_CUSTOMER_PRICES'
          : 'DISCOUNT_REJECTED';
      return false;
    }
  }

  async function removeDiscount(): Promise<void> {
    await mutate(async (id) => {
      cart.value = viaServer()
        ? await $fetch<EldraCart>(`/api/cart/${encodeURIComponent(id)}/discount`, {
            method: 'DELETE',
            query: { locale: locale.value },
          })
        : await eldra.cart.removeDiscount(id, { locale: locale.value });
    });
  }

  // Replayed through add-to-cart so every item is re-priced and re-stocked.
  async function recoverBasket(token: string): Promise<{ restored: number; missing: number }> {
    if (!token.trim()) return { restored: 0, missing: 0 };
    lastError.value = null;
    let basket;
    try {
      basket = await eldra.orders.recover(token);
    } catch {
      lastError.value = 'LINK_EXPIRED';
      return { restored: 0, missing: 0 };
    }
    let restored = 0;
    let missing = basket.unavailable?.length ?? 0;
    if (basket.cartId) {
      // The server rebuilt the basket and marked where it came from; we only keep the id.
      cartId.value = basket.cartId;
      session.remember(basket.cartId);
      await loadCart();
      restored = (basket.items?.length ?? 0) - missing;
    } else {
      for (const item of basket.items ?? []) {
        try {
          await addItem(item.productId, item.variantId, item.quantity);
          restored += 1;
        } catch {
          missing += 1;
        }
      }
    }
    drawerOpen.value = false;
    return { restored, missing };
  }

  return {
    cartId,
    cart,
    lastError,
    notice,
    discountAllowed,
    drawerOpen,
    count,
    checkoutUrl,
    loadCart,
    addItem,
    updateQuantity,
    removeItem,
    applyDiscount,
    removeDiscount,
    recoverBasket,
    forgetCart,
  };
});
