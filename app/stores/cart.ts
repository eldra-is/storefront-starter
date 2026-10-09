import { defineStore, skipHydrate } from 'pinia';
import { computed, ref } from 'vue';
import { createCartSession } from '@eldrajs/sdk';
import type { EldraAddCartItemInput, EldraCart } from '@eldrajs/sdk';
import {
  PRICED_FOR_HEADER,
  SIGNED_OUT_PRICING,
  boundCompanyOf,
  cartBindingAction,
  cartRefusal,
  type CartNotice,
} from '~~/shared/utils/customer-prices';

/** Starter-prefixed so a site never picks up a cart id another storefront left on the same origin. */
const CART_STORAGE_KEY = 'storefront-starter.cartId';
/** The company the stored cart was last written for; the web cart itself does not say. */
const CART_BOUND_TO_KEY = 'storefront-starter.cartBoundTo';

/** A write's answer and the company the server says it was priced for (null: a guest write). */
interface Written<T> {
  data: T;
  boundFor: string | null;
}

/**
 * A guest's cart calls go from the browser to the gateway. A signed-in business customer's writes go
 * through server/api/cart, which adds their token and company, so the cart is bound to the company
 * and priced for it; reads by cart id stay direct (they are open, for hosted checkout too).
 *
 * A cart is never shown, or sent to checkout, for a buyer it was not priced for: before its prices
 * are shown it is checked against who is buying (`cartBindingAction`). Another company's cart, or a
 * guest cart once signed in, is moved: its lines are replayed into a new cart for this company and
 * the person is told. A company cart for someone who is now a guest is moved to a guest cart the
 * same way; only an explicit sign-out drops it. The company a cart is bound to is taken from the
 * server's answer (PRICED_FOR_HEADER), never assumed.
 */
export const useCartStore = defineStore('cart', () => {
  const eldra = useEldraClient();
  const { locale } = useLocale();
  const pricing = useCustomerPricing();
  const viaServer = () => pricing.value.signedIn;
  // Browser storage in the browser; nothing on the server.
  const storage = import.meta.server ? null : undefined;
  const session = createCartSession({ storage, key: CART_STORAGE_KEY });
  const binding = createCartSession({ storage, key: CART_BOUND_TO_KEY });

  // Client-local state; without skipHydrate the server's null would overwrite the restored id.
  const cartId = skipHydrate(ref<string | null>(session.read()));
  const boundTo = skipHydrate(ref<string | null>(binding.read()));
  const cart = ref<EldraCart | null>(null);
  const lastError = ref<string | null>(null);
  /** Why the cart now holds different prices (it was moved), to tell the person. */
  const notice = ref<CartNotice | null>(null);
  const drawerOpen = ref(false);
  const moving = ref(false);
  /** A move that could not be made: no checkout until a load finds the cart is this buyer's. */
  const moveFailed = ref(false);

  const count = computed(
    () => cart.value?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0
  );
  const action = computed(() => cartBindingAction(boundTo.value, pricing.value, count.value > 0));
  // handoffUrl throws when a non-production gateway has no checkout origin configured. No checkout
  // while the cart is being moved, could not be moved, or is not this buyer's.
  const checkoutUrl = computed(() => {
    if (!cartId.value || !cart.value || moving.value || moveFailed.value) return null;
    if (action.value !== 'keep') return null;
    try {
      return eldra.checkout.handoffUrl({ cartId: cartId.value, locale: locale.value });
    } catch {
      return null;
    }
  });

  function setBoundTo(customerId: string | null) {
    boundTo.value = customerId;
    if (customerId) binding.remember(customerId);
    else binding.forget();
  }

  /** Keeps a cart a write answered with, and the company the server priced it for. */
  function rememberCart(id: string, boundFor: string | null) {
    cartId.value = id;
    session.remember(id);
    setBoundTo(boundFor);
  }

  function forgetCart() {
    cartId.value = null;
    cart.value = null;
    session.forget();
    setBoundTo(null);
  }

  /** Forgets a company cart on purpose (sign-out): a shared device must not keep company prices. */
  function forgetCompanyCart() {
    if (boundTo.value) forgetCart();
  }

  /**
   * A write through this site's cart routes. The answer says how it was priced: a guest answer while
   * the browser thought it was signed in means the server session is gone, so the browser buys as a
   * guest from here on.
   */
  async function serverWrite<T>(
    url: string,
    options: { method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown; query?: Record<string, string> }
  ): Promise<Written<T>> {
    const response = await $fetch.raw<T>(url, options as Parameters<typeof $fetch.raw>[1]);
    const header = response.headers.get(PRICED_FOR_HEADER);
    const boundFor = boundCompanyOf(header, pricing.value.customerId);
    if (header === 'guest' && pricing.value.signedIn) pricing.value = { ...SIGNED_OUT_PRICING };
    return { data: response._data as T, boundFor };
  }

  async function postItem(input: EldraAddCartItemInput): Promise<Written<EldraCart>> {
    if (viaServer()) {
      return serverWrite<EldraCart>('/api/cart/items', { method: 'POST', body: input });
    }
    return { data: await eldra.cart.addItem(input), boundFor: null };
  }

  /**
   * Moves the cart to who is buying now: replays its lines through add-to-cart into a new cart, so
   * every line is priced (and stocked) for them, then switches to it and says so. Lines that cannot
   * be carried over are counted. When none could be, the old cart is kept (nothing is lost), checkout
   * is withheld and the move is tried again on the next load.
   */
  async function moveCart(
    reason: CartNotice['reason'],
    source?: EldraCart | null
  ): Promise<boolean> {
    moving.value = true;
    try {
      const oldId = cartId.value;
      let old = source ?? cart.value;
      if (!old && oldId) {
        try {
          old = await eldra.cart.get(oldId, { locale: locale.value });
        } catch {
          // A read that failed is not an empty cart: keep it and try again later.
          cart.value = null;
          moveFailed.value = true;
          lastError.value = 'CART_MOVE_FAILED';
          return false;
        }
      }
      const lines = old?.items ?? [];
      if (lines.length === 0) {
        forgetCart();
        return true;
      }
      let newId: string | null = null;
      let boundFor: string | null = null;
      let missing = 0;
      for (const line of lines) {
        try {
          const written = await postItem({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            ...(newId ? { cartId: newId } : {}),
          });
          newId = written.data?.id ?? newId;
          boundFor = written.boundFor;
        } catch {
          missing += 1;
        }
      }
      if (!newId) {
        cart.value = null;
        moveFailed.value = true;
        lastError.value = 'CART_MOVE_FAILED';
        return false;
      }
      // A guest cart is priced for nobody, whatever the answer said; a company move the server ran
      // as a guest (the session ended meanwhile) is a guest cart too, and is told as one.
      const priced = reason === 'company' && boundFor ? 'company' : 'guest';
      rememberCart(newId, priced === 'company' ? boundFor : null);
      moveFailed.value = false;
      notice.value = {
        reason: priced,
        companyName: priced === 'company' ? pricing.value.customerName : null,
        missing,
      };
      cart.value = await eldra.cart.get(newId, { locale: locale.value });
      return true;
    } finally {
      moving.value = false;
    }
  }

  let loading: Promise<void> | null = null;

  /** Reads the cart, and first moves it when it is not the current buyer's. */
  function loadCart(): Promise<void> {
    loading ??= (async () => {
      if (!cartId.value) return;
      let read: EldraCart;
      try {
        read = await eldra.cart.get(cartId.value, { locale: locale.value });
      } catch (err) {
        // Reading the cart by id: any not-found answer can only mean the cart.
        if (isNotFound(err)) forgetCart();
        return;
      }
      const next = cartBindingAction(boundTo.value, pricing.value, (read.items?.length ?? 0) > 0);
      if (next === 'move') await moveCart('company', read);
      else if (next === 'to-guest') await moveCart('guest', read);
      else if (next === 'wait') {
        // Whose prices these are cannot be known yet: show nothing priced and allow no checkout.
        cart.value = null;
        lastError.value = pricing.value.needsCompany ? 'CART_CHOOSE_COMPANY' : 'CART_WAIT';
      } else {
        cart.value = read;
        moveFailed.value = false;
      }
    })().finally(() => (loading = null));
    return loading;
  }

  /** Before a write: make sure the stored cart is this buyer's (moving it when it is not). */
  async function ensureBuyersCart(): Promise<void> {
    if (cartId.value && cartBindingAction(boundTo.value, pricing.value, true) !== 'keep') {
      await loadCart();
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
   * moved (its lines replayed into a new cart for whoever is buying now). Answers `moved`,
   * `failed` (the cart is kept, the change is not retried) or `no` (another refusal).
   */
  async function moveIfBound(err: unknown): Promise<'moved' | 'failed' | 'no'> {
    const refusal = cartRefusal(errorIdOf(err));
    let moved: boolean;
    if (refusal === 'new-cart-other-company') moved = await moveCart('company');
    else if (refusal === 'new-cart-sign-in') {
      // The server no longer has a business session for this browser: buy as a guest from here on.
      pricing.value = { ...SIGNED_OUT_PRICING };
      moved = await moveCart('guest');
    } else return 'no';
    return moved ? 'moved' : 'failed';
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
    if (!retried) {
      notice.value = null;
      await ensureBuyersCart();
    }
    let written: Written<EldraCart>;
    try {
      written = await postItem({
        productId,
        variantId,
        quantity,
        ...(cartId.value ? { cartId: cartId.value } : {}),
      });
    } catch (err) {
      // The server refuses an unknown cart id rather than reviving it; start a fresh cart, once.
      // A missing product or variant also answers not found, so the cart is only dropped when gone.
      // A cart bound to another company (or needing a sign-in) is moved first, its lines kept.
      if (!retried) {
        const move = await moveIfBound(err);
        if (move === 'failed') throw err;
        if (move === 'moved' || (await forgetIfGone(err))) {
          return addItem(productId, variantId, quantity, true);
        }
      }
      noteRefusal(err);
      throw err;
    }
    if (written.data?.id) rememberCart(written.data.id, written.boundFor);
    await loadCart();
    drawerOpen.value = true;
  }

  /** The same item (by variant) in the cart as it is now. */
  const lineFor = (variantId: string | undefined) =>
    variantId ? cart.value?.items?.find((item) => item.variantId === variantId) : undefined;

  /**
   * Runs a change to one line of the stored cart. When the cart had to be moved first (before the
   * change, or because the change was refused), the change is made on the same item in the new cart.
   * A failure that means the cart is gone forgets it; any other failure is rethrown.
   */
  async function mutateLine(
    itemId: string | null,
    run: (id: string, itemId: string) => Promise<Written<unknown>>
  ): Promise<void> {
    if (!cartId.value) return;
    lastError.value = null;
    notice.value = null;
    // Read before anything can move the cart: the new cart's lines are found by variant.
    const variantId = cart.value?.items?.find((item) => item.id === itemId)?.variantId;
    const before = cartId.value;
    await ensureBuyersCart();
    if (!cartId.value) return;
    let line = itemId ?? '';
    if (itemId !== null && cartId.value !== before) {
      const moved = lineFor(variantId);
      if (!moved) return;
      line = moved.id;
    }
    try {
      const written = await run(cartId.value, line);
      // A direct write is a guest's (unbound); a server write says what it was priced for.
      rememberCart(cartId.value, written.boundFor);
    } catch (err) {
      const move = await moveIfBound(err);
      if (move === 'failed') throw err;
      if (move === 'moved') {
        if (itemId === null) return;
        const moved = lineFor(variantId);
        if (cartId.value && moved) await run(cartId.value, moved.id);
        return;
      }
      await forgetIfGone(err);
      noteRefusal(err);
      throw err;
    }
  }

  const itemPath = (id: string, itemId: string) =>
    `/api/cart/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`;

  // Mutations answer with the unlocalised cart, so state is always set by the localised read.
  async function updateQuantity(itemId: string, quantity: number): Promise<void> {
    await mutateLine(itemId, async (id, line) =>
      viaServer()
        ? serverWrite(itemPath(id, line), { method: 'PATCH', body: { quantity } })
        : { data: await eldra.cart.updateItem(id, line, { quantity }), boundFor: null }
    );
    await loadCart();
  }

  async function removeItem(itemId: string): Promise<void> {
    await mutateLine(itemId, async (id, line) =>
      viaServer()
        ? serverWrite(itemPath(id, line), { method: 'DELETE' })
        : { data: await eldra.cart.removeItem(id, line), boundFor: null }
    );
    await loadCart();
  }

  /**
   * Discount codes do not combine with customer prices: a cart bound to a company takes none (the
   * server refuses it too, CART_DISCOUNT_NOT_FOR_CUSTOMER_PRICES).
   */
  const discountAllowed = computed(() => !boundTo.value);

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
    await mutateLine(null, async (id) => {
      const written = viaServer()
        ? await serverWrite<EldraCart>(`/api/cart/${encodeURIComponent(id)}/discount`, {
            method: 'DELETE',
            query: { locale: locale.value },
          })
        : { data: await eldra.cart.removeDiscount(id, { locale: locale.value }), boundFor: null };
      cart.value = written.data;
      return written;
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
      // A rebuilt cart is unbound; loadCart moves it to the company when someone is signed in.
      rememberCart(basket.cartId, null);
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
    boundTo,
    moving,
    moveFailed,
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
    forgetCompanyCart,
  };
});
