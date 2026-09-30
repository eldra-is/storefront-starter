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
      if (isCartNotFound(err)) forgetCart();
    }
  }

  async function addItem(productId: string, variantId: string, quantity: number): Promise<void> {
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
      // The server refuses an unknown cart id rather than reviving it; start a fresh cart.
      if (isCartNotFound(err) && cartId.value) {
        forgetCart();
        return addItem(productId, variantId, quantity);
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

  // Mutations answer with the unlocalised cart, so state is always set by the localised read.
  async function updateQuantity(itemId: string, quantity: number): Promise<void> {
    if (!cartId.value) return;
    await eldra.cart.updateItem(cartId.value, itemId, { quantity });
    await loadCart();
  }

  async function removeItem(itemId: string): Promise<void> {
    if (!cartId.value) return;
    await eldra.cart.removeItem(cartId.value, itemId);
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
    if (!cartId.value) return;
    cart.value = await eldra.cart.removeDiscount(cartId.value, { locale: locale.value });
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
  };
});
