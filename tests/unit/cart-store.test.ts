import { EldraHttpError } from '@eldrajs/sdk';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { errorIdOf, isCartGone, isNotFound } from '../../app/utils/errors';
import { SIGNED_OUT_PRICING, type CustomerPricingState } from '../../shared/utils/customer-prices';

// The cart store runs against stubbed Nuxt globals: the gateway client (`useEldraClient`), this
// site's own server routes (`$fetch`), the pricing state and browser storage.

const CART_KEY = 'storefront-starter.cartId';
const BOUND_KEY = 'storefront-starter.cartBoundTo';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const line = (id: string, variantId: string, quantity = 1) => ({
  id,
  productId: `p-${variantId}`,
  variantId,
  quantity,
  price: 100,
  title: variantId,
});
const cartOf = (id: string, items: ReturnType<typeof line>[]) => ({ id, items });
const routeError = (statusCode: number, errorId: string) =>
  Object.assign(new Error('FetchError'), { data: { statusCode, data: { errorId } } });
const gatewayError = (status: number, errorId: string) =>
  new EldraHttpError(new Response(null, { status }), { code: 'CONFLICT', errorId });

let storage: MemoryStorage;
let pricing: ReturnType<typeof ref<CustomerPricingState>>;
let carts: Record<string, ReturnType<typeof cartOf>>;
let serverFetch: ReturnType<typeof vi.fn>;
let eldra: {
  cart: Record<string, ReturnType<typeof vi.fn>>;
  checkout: { handoffUrl: (o: { cartId: string }) => string };
  orders: Record<string, ReturnType<typeof vi.fn>>;
};

function signedInAs(customerId: string, customerName = customerId): CustomerPricingState {
  return { ...SIGNED_OUT_PRICING, signedIn: true, customerId, customerName };
}

async function store() {
  const { useCartStore } = await import('../../app/stores/cart');
  return useCartStore();
}

beforeEach(() => {
  vi.resetModules();
  setActivePinia(createPinia());
  storage = new MemoryStorage();
  carts = {};
  pricing = ref<CustomerPricingState>({ ...SIGNED_OUT_PRICING });
  serverFetch = vi.fn();
  eldra = {
    cart: {
      get: vi.fn(async (id: string) => {
        const found = carts[id];
        if (!found)
          throw new EldraHttpError(new Response(null, { status: 404 }), { code: 'NOT_FOUND' });
        return found;
      }),
      addItem: vi.fn(),
      updateItem: vi.fn(),
      removeItem: vi.fn(),
      applyDiscount: vi.fn(),
      removeDiscount: vi.fn(),
    },
    checkout: { handoffUrl: ({ cartId }) => `https://checkout.example/${cartId}` },
    orders: {},
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('useEldraClient', () => eldra);
  vi.stubGlobal('useLocale', () => ({ locale: ref('en-US') }));
  vi.stubGlobal('useCustomerPricing', () => pricing);
  vi.stubGlobal('$fetch', serverFetch);
  vi.stubGlobal('errorIdOf', errorIdOf);
  vi.stubGlobal('isNotFound', isNotFound);
  vi.stubGlobal('isCartGone', isCartGone);
});

describe('cart store: a cart priced for someone else is never shown', () => {
  it('moves another company’s cart on load, replaying its lines into a cart for this company', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1', 2), line('i2', 'v2')]);
    pricing.value = signedInAs('b', 'Beta hf.');
    serverFetch
      .mockResolvedValueOnce({ id: 'new' })
      .mockRejectedValueOnce(routeError(404, 'NOT_FOUND'));
    carts.new = cartOf('new', [line('n1', 'v1', 2)]);

    const cart = await store();
    expect(cart.checkoutUrl).toBeNull();
    await cart.loadCart();

    expect(serverFetch.mock.calls[0]).toEqual([
      '/api/cart/items',
      { method: 'POST', body: { productId: 'p-v1', variantId: 'v1', quantity: 2 } },
    ]);
    expect(serverFetch.mock.calls[1]?.[1]?.body).toMatchObject({ variantId: 'v2', cartId: 'new' });
    expect(cart.cartId).toBe('new');
    expect(cart.boundTo).toBe('b');
    expect(storage.getItem(CART_KEY)).toBe('new');
    expect(storage.getItem(BOUND_KEY)).toBe('b');
    expect(cart.cart?.id).toBe('new');
    expect(cart.notice).toEqual({ reason: 'company', companyName: 'Beta hf.', missing: 1 });
    expect(cart.checkoutUrl).toBe('https://checkout.example/new');
  });

  it('keeps the old cart (nothing lost) when no line can be moved, with no checkout', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    pricing.value = signedInAs('b');
    serverFetch.mockRejectedValue(routeError(503, 'CART_PRICES_UNAVAILABLE'));

    const cart = await store();
    await cart.loadCart();

    expect(cart.cartId).toBe('old');
    expect(storage.getItem(BOUND_KEY)).toBe('a');
    expect(cart.cart).toBeNull();
    expect(cart.lastError).toBe('CART_MOVE_FAILED');
    expect(cart.checkoutUrl).toBeNull();
  });

  it('forgets a company cart once the browser is signed out', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1')]);

    const cart = await store();
    await cart.loadCart();

    expect(cart.cartId).toBeNull();
    expect(cart.cart).toBeNull();
    expect(storage.getItem(CART_KEY)).toBeNull();
    expect(storage.getItem(BOUND_KEY)).toBeNull();
  });

  it('forgets a company cart on sign-out, and leaves a guest cart alone', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    const cart = await store();
    cart.forgetCompanyCart();
    expect(storage.getItem(CART_KEY)).toBeNull();

    storage.setItem(CART_KEY, 'guest');
    setActivePinia(createPinia());
    vi.resetModules();
    const guest = await store();
    guest.forgetCompanyCart();
    expect(storage.getItem(CART_KEY)).toBe('guest');
  });
});

describe('cart store: refused writes keep the basket', () => {
  it('on CART_CUSTOMER_MISMATCH moves the lines to this company, then adds the item', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    pricing.value = signedInAs('b', 'Beta hf.');
    serverFetch
      .mockRejectedValueOnce(routeError(409, 'CART_CUSTOMER_MISMATCH'))
      .mockResolvedValueOnce({ id: 'new' })
      .mockResolvedValueOnce({ id: 'new' });
    carts.new = cartOf('new', [line('n1', 'v1'), line('n2', 'v3')]);

    const cart = await store();
    await cart.addItem('p-v3', 'v3', 1);

    expect(serverFetch).toHaveBeenCalledTimes(3);
    expect(serverFetch.mock.calls[1]?.[1]?.body).toEqual({
      productId: 'p-v1',
      variantId: 'v1',
      quantity: 1,
    });
    expect(serverFetch.mock.calls[2]?.[1]?.body).toMatchObject({ variantId: 'v3', cartId: 'new' });
    expect(cart.cartId).toBe('new');
    expect(cart.cart?.items).toHaveLength(2);
    expect(cart.notice).toEqual({ reason: 'company', companyName: 'Beta hf.', missing: 0 });
  });

  it('on CART_CUSTOMER_MISMATCH while changing a quantity, moves and makes the change on the new line', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    pricing.value = signedInAs('b');
    carts.new = cartOf('new', [line('n1', 'v1')]);
    serverFetch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(routeError(409, 'CART_CUSTOMER_MISMATCH'))
      .mockResolvedValueOnce({ id: 'new' })
      .mockResolvedValueOnce(undefined);

    const cart = await store();
    await cart.loadCart();
    await cart.updateQuantity('i1', 1);
    await cart.updateQuantity('i1', 3);

    expect(serverFetch.mock.calls[3]).toEqual([
      '/api/cart/new/items/n1',
      { method: 'PATCH', body: { quantity: 3 } },
    ]);
    expect(cart.cartId).toBe('new');
  });

  it('on CART_SIGN_IN_REQUIRED moves the lines to a guest cart at list prices', async () => {
    storage.setItem(CART_KEY, 'old');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.g1 = cartOf('g1', [line('g1', 'v1'), line('g2', 'v3')]);
    eldra.cart.addItem
      .mockRejectedValueOnce(gatewayError(409, 'CART_SIGN_IN_REQUIRED'))
      .mockResolvedValueOnce({ id: 'g1' })
      .mockResolvedValueOnce({ id: 'g1' });

    const cart = await store();
    await cart.addItem('p-v3', 'v3', 1);

    expect(eldra.cart.addItem).toHaveBeenCalledTimes(3);
    expect(serverFetch).not.toHaveBeenCalled();
    expect(cart.cartId).toBe('g1');
    expect(cart.boundTo).toBeNull();
    expect(cart.notice).toEqual({ reason: 'guest', companyName: null, missing: 0 });
  });

  it('a signed-in session that ended server-side moves to a guest cart and goes direct from then on', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.g1 = cartOf('g1', [line('g1', 'v1')]);
    pricing.value = signedInAs('b');
    serverFetch.mockRejectedValueOnce(routeError(409, 'CART_SIGN_IN_REQUIRED'));
    eldra.cart.addItem.mockResolvedValue({ id: 'g1' });

    const cart = await store();
    await cart.addItem('p-v1', 'v1', 1);

    expect(pricing.value.signedIn).toBe(false);
    expect(eldra.cart.addItem).toHaveBeenCalledTimes(2);
    expect(cart.cartId).toBe('g1');
    expect(storage.getItem(BOUND_KEY)).toBeNull();
  });
});

describe('cart store: discount codes', () => {
  it('are offered for a cart not bound to a company, whoever is signed in', async () => {
    pricing.value = signedInAs('b');
    const cart = await store();
    expect(cart.discountAllowed).toBe(true);
  });

  it('are refused locally for a company cart', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    pricing.value = signedInAs('b');
    const cart = await store();
    expect(cart.discountAllowed).toBe(false);
    await expect(cart.applyDiscount('SUMMER')).resolves.toBe(false);
    expect(cart.lastError).toBe('DISCOUNT_NOT_FOR_CUSTOMER_PRICES');
    expect(eldra.cart.applyDiscount).not.toHaveBeenCalled();
  });

  it('a signed-in add binds the cart, which then takes no code', async () => {
    pricing.value = signedInAs('b');
    serverFetch.mockResolvedValueOnce({ id: 'new' });
    carts.new = cartOf('new', [line('n1', 'v1')]);
    const cart = await store();
    await cart.addItem('p-v1', 'v1', 1);
    expect(cart.boundTo).toBe('b');
    expect(cart.discountAllowed).toBe(false);
  });
});
