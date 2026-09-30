import { defineStore, skipHydrate } from 'pinia';
import { computed, ref } from 'vue';
import { createCartSession } from '@eldrajs/sdk';
import type { EldraCart } from '@eldrajs/sdk';

/** Starter-prefixed so a site never picks up a cart id another storefront left on the same origin. */
const CART_STORAGE_KEY = 'storefront-starter.cartId';

export const useCartStore = defineStore('cart', () => {
  const eldra = useEldraClient();
  const { locale } = useLocale();
  const session = createCartSession({
    storage: import.meta.client ? undefined : null,
    key: CART_STORAGE_KEY,
  });

  // Client-local state; without skipHydrate the server's null would overwrite the restored id.
  const cartId = skipHydrate(ref<string | null>(session.read()));
  const cart = ref<EldraCart | null>(null);
  const lastError = ref<string | null>(null);
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

  async function addItem(
    productId: string,
    variantId: string,
    quantity: number,
    retried = false
  ): Promise<void> {
    lastError.value = null;
    let result: EldraCart;
    try {
      result = await eldra.cart.addItem({
        productId,
        variantId,
        quantity,
        ...(cartId.value ? { cartId: cartId.value } : {}),
      });
    } catch (err) {
      // The server refuses an unknown cart id rather than reviving it; start a fresh cart, once.
      // A missing product or variant also answers not found, so the cart is only dropped when gone.
      if (!retried && (await forgetIfGone(err))) {
        return addItem(productId, variantId, quantity, true);
      }
      if (isOutOfStock(err)) lastError.value = 'INSUFFICIENT_STOCK';
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
    try {
      await run(cartId.value);
    } catch (err) {
      await forgetIfGone(err);
      throw err;
    }
  }

  // Mutations answer with the unlocalised cart, so state is always set by the localised read.
  async function updateQuantity(itemId: string, quantity: number): Promise<void> {
    await mutate((id) => eldra.cart.updateItem(id, itemId, { quantity }));
    await loadCart();
  }

  async function removeItem(itemId: string): Promise<void> {
    await mutate((id) => eldra.cart.removeItem(id, itemId));
    await loadCart();
  }

  async function applyDiscount(code: string): Promise<boolean> {
    if (!cartId.value || !code.trim()) return false;
    lastError.value = null;
    try {
      const { cart: repriced, applied } = await eldra.cart.applyDiscount(cartId.value, code, {
        locale: locale.value,
      });
      cart.value = repriced;
      if (!applied) lastError.value = 'DISCOUNT_REJECTED';
      return applied;
    } catch {
      lastError.value = 'DISCOUNT_REJECTED';
      return false;
    }
  }

  async function removeDiscount(): Promise<void> {
    await mutate(async (id) => {
      cart.value = await eldra.cart.removeDiscount(id, { locale: locale.value });
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
