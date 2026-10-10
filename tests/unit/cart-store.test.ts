import { EldraHttpError } from '@eldrajs/sdk';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { errorIdOf, isCartGone, isNotFound, statusOf } from '../../app/utils/errors';
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
/** `storage` listeners the store registered (another tab changing the cart). */
let storageListeners: ((event: { key: string | null }) => void)[];
let pricing: ReturnType<typeof ref<CustomerPricingState>>;
let carts: Record<string, ReturnType<typeof cartOf>>;
let serverFetch: ReturnType<typeof vi.fn>;
/** What the cart routes say a write was priced for (X-Eldra-Priced-For); the active company by default. */
let pricedFor: () => string;
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
  pricedFor = () => pricing.value.customerId ?? 'guest';
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
  vi.stubGlobal(
    '$fetch',
    Object.assign(vi.fn(), {
      raw: async (url: string, options: unknown) => {
        const data = await serverFetch(url, options);
        return { _data: data, headers: new Headers({ 'X-Eldra-Priced-For': pricedFor() }) };
      },
    })
  );
  vi.stubGlobal('errorIdOf', errorIdOf);
  vi.stubGlobal('isNotFound', isNotFound);
  vi.stubGlobal('isCartGone', isCartGone);
  vi.stubGlobal('statusOf', statusOf);
  storageListeners = [];
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
      if (type === 'storage') storageListeners.push(listener);
    },
  });
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

  it('moves a company cart to a guest cart once the browser is signed out', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1', 2)]);
    carts.g1 = cartOf('g1', [line('g1', 'v1', 2)]);
    eldra.cart.addItem.mockResolvedValueOnce({ id: 'g1' });

    const cart = await store();
    await cart.loadCart();

    expect(eldra.cart.addItem).toHaveBeenCalledWith({
      productId: 'p-v1',
      variantId: 'v1',
      quantity: 2,
    });
    expect(serverFetch).not.toHaveBeenCalled();
    expect(cart.cartId).toBe('g1');
    expect(storage.getItem(BOUND_KEY)).toBeNull();
    expect(cart.notice).toEqual({ reason: 'guest', companyName: null, missing: 0 });
    expect(cart.checkoutUrl).toBe('https://checkout.example/g1');
  });

  it('says nothing when there was nothing to move', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', []);
    pricing.value = signedInAs('b');

    const cart = await store();
    await cart.loadCart();

    expect(serverFetch).not.toHaveBeenCalled();
    expect(cart.cartId).toBeNull();
    expect(cart.notice).toBeNull();
  });

  it('shows no company cart, and no checkout, while the company cannot be known', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    pricing.value = { ...SIGNED_OUT_PRICING, signedIn: true };

    const cart = await store();
    await cart.loadCart();

    expect(cart.cart).toBeNull();
    expect(cart.lastError).toBe('CART_WAIT');
    expect(cart.checkoutUrl).toBeNull();
    expect(cart.cartId).toBe('old');
    expect(storage.getItem(BOUND_KEY)).toBe('a');
    expect(serverFetch).not.toHaveBeenCalled();
  });

  it('asks to choose a company before showing a cart when several are possible', async () => {
    storage.setItem(CART_KEY, 'old');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    pricing.value = { ...SIGNED_OUT_PRICING, signedIn: true, needsCompany: true };
    const cart = await store();
    await cart.loadCart();
    expect(cart.cart).toBeNull();
    expect(cart.lastError).toBe('CART_CHOOSE_COMPANY');
  });

  it('moves a company cart to a guest cart when the person no longer has a company', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.g1 = cartOf('g1', [line('g1', 'v1')]);
    pricing.value = { ...SIGNED_OUT_PRICING, signedIn: true, noCompany: true };
    serverFetch.mockResolvedValueOnce({ id: 'g1' });

    const cart = await store();
    await cart.loadCart();

    expect(cart.cartId).toBe('g1');
    expect(cart.boundTo).toBeNull();
    expect(pricing.value.signedIn).toBe(false);
    expect(cart.notice?.reason).toBe('guest');
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

describe('cart store: the binding comes from the server', () => {
  it('binds to the company the cart route says it priced for', async () => {
    pricing.value = signedInAs('b');
    pricedFor = () => 'b';
    serverFetch.mockResolvedValueOnce({ id: 'new' });
    carts.new = cartOf('new', [line('n1', 'v1')]);
    const cart = await store();
    await cart.addItem('p-v1', 'v1', 1);
    expect(storage.getItem(BOUND_KEY)).toBe('b');
  });

  it('a write the server ran as a guest binds nothing and makes the browser a guest', async () => {
    pricing.value = signedInAs('b');
    pricedFor = () => 'guest';
    serverFetch.mockResolvedValueOnce({ id: 'new' });
    carts.new = cartOf('new', [line('n1', 'v1')]);
    const cart = await store();
    await cart.addItem('p-v1', 'v1', 1);
    expect(cart.boundTo).toBeNull();
    expect(storage.getItem(BOUND_KEY)).toBeNull();
    expect(pricing.value.signedIn).toBe(false);
    expect(cart.discountAllowed).toBe(true);
  });

  it('a change after the company switched is made on the same item in the moved cart', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.new = cartOf('new', [line('n1', 'v1')]);
    pricing.value = signedInAs('b');
    const cart = await store();
    await cart.loadCart();

    pricing.value = signedInAs('c');
    serverFetch.mockResolvedValueOnce({ id: 'new' }).mockResolvedValueOnce(undefined);
    await cart.updateQuantity('i1', 3);

    expect(serverFetch.mock.calls[1]).toEqual([
      '/api/cart/new/items/n1',
      { method: 'PATCH', body: { quantity: 3 } },
    ]);
  });

  it('a move that fails withholds checkout until a load finds the cart is this buyer’s', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    pricing.value = signedInAs('b');
    const cart = await store();
    await cart.loadCart();
    expect(cart.checkoutUrl).toBe('https://checkout.example/old');

    serverFetch.mockRejectedValue(routeError(409, 'CART_CUSTOMER_MISMATCH'));
    await expect(cart.addItem('p-v2', 'v2', 1)).rejects.toBeTruthy();
    expect(cart.cartId).toBe('old');
    expect(cart.checkoutUrl).toBeNull();

    await cart.loadCart();
    expect(cart.checkoutUrl).toBe('https://checkout.example/old');
  });
});

describe('cart store: round 3', () => {
  it('a failed read of the old cart during a move keeps the cart and withholds checkout', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    pricing.value = signedInAs('b');
    serverFetch.mockRejectedValueOnce(routeError(409, 'CART_CUSTOMER_MISMATCH'));
    eldra.cart.get.mockRejectedValue(new Error('offline'));

    const cart = await store();
    await expect(cart.addItem('p-v1', 'v1', 1)).rejects.toBeTruthy();

    expect(cart.cartId).toBe('old');
    expect(storage.getItem(CART_KEY)).toBe('old');
    expect(storage.getItem(BOUND_KEY)).toBe('b');
    expect(cart.moveFailed).toBe(true);
    expect(cart.checkoutUrl).toBeNull();
  });

  it('a company move the server ran as a guest is told as a move to a guest cart', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.new = cartOf('new', [line('n1', 'v1')]);
    pricing.value = signedInAs('b', 'Beta hf.');
    pricedFor = () => 'guest';
    serverFetch.mockResolvedValueOnce({ id: 'new' });

    const cart = await store();
    await cart.loadCart();

    expect(cart.cartId).toBe('new');
    expect(cart.boundTo).toBeNull();
    expect(cart.notice).toEqual({ reason: 'guest', companyName: null, missing: 0 });
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

describe('cart store: a write never unbinds a company cart (P3-R7)', () => {
  it('a removal the server ran as a guest on a company cart moves it to a guest cart', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1', 2), line('i2', 'v2')]);
    pricing.value = signedInAs('b');
    const cart = await store();
    await cart.loadCart();
    expect(cart.checkoutUrl).toBe('https://checkout.example/old');

    // The session ended server-side; the removal ran as a guest and succeeded (the line is gone).
    pricedFor = () => 'guest';
    serverFetch.mockImplementationOnce(async () => {
      carts.old = cartOf('old', [line('i1', 'v1', 2)]);
      return carts.old;
    });
    eldra.cart.addItem.mockResolvedValueOnce({ id: 'g1' });
    carts.g1 = cartOf('g1', [line('g1', 'v1', 2)]);
    await cart.removeItem('i2');

    expect(serverFetch.mock.calls[0]?.[0]).toBe('/api/cart/old/items/i2');
    expect(pricing.value.signedIn).toBe(false);
    // The replay is a guest's, direct, and carries only what is left.
    expect(eldra.cart.addItem).toHaveBeenCalledExactlyOnceWith({
      productId: 'p-v1',
      variantId: 'v1',
      quantity: 2,
    });
    expect(cart.cartId).toBe('g1');
    expect(cart.boundTo).toBeNull();
    expect(cart.notice).toEqual({ reason: 'guest', companyName: null, missing: 0 });
    expect(cart.checkoutUrl).toBe('https://checkout.example/g1');
  });

  it('when that move cannot be made, the cart stays company-bound: no checkout, no code entry', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1'), line('i2', 'v2')]);
    pricing.value = signedInAs('b');
    const cart = await store();
    await cart.loadCart();

    pricedFor = () => 'guest';
    serverFetch.mockResolvedValueOnce(undefined);
    eldra.cart.addItem.mockRejectedValue(new Error('offline'));
    await cart.removeItem('i2');

    expect(cart.cartId).toBe('old');
    expect(cart.boundTo).toBe('b');
    expect(storage.getItem(BOUND_KEY)).toBe('b');
    expect(cart.checkoutUrl).toBeNull();
    expect(cart.discountAllowed).toBe(false);
  });

  it('a direct guest removal on a company cart (an earlier move failed) does not unbind it', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1'), line('i2', 'v2')]);
    // Signed out: every attempt to move the cart to a guest cart fails (offline).
    eldra.cart.addItem.mockRejectedValue(new Error('offline'));
    const cart = await store();
    await cart.loadCart();
    expect(cart.moveFailed).toBe(true);

    eldra.cart.removeItem.mockResolvedValueOnce(undefined);
    cart.cart = carts.old as never;
    await cart.removeItem('i2');
    expect(eldra.cart.removeItem).toHaveBeenCalledWith('old', 'i2');
    expect(storage.getItem(BOUND_KEY)).toBe('b');
    expect(cart.checkoutUrl).toBeNull();
  });
});

describe('cart store: a move never loses lines to a failure that may pass', () => {
  it('lines 1 and 3 move, line 2 meets 503: the old cart is kept and nothing is forgotten', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1'), line('i2', 'v2'), line('i3', 'v3')]);
    pricing.value = signedInAs('b');
    serverFetch
      .mockResolvedValueOnce({ id: 'new' })
      .mockRejectedValueOnce(routeError(503, 'CART_PRICES_UNAVAILABLE'))
      .mockResolvedValueOnce({ id: 'new' });

    const cart = await store();
    await cart.loadCart();

    expect(cart.cartId).toBe('old');
    expect(storage.getItem(CART_KEY)).toBe('old');
    expect(storage.getItem(BOUND_KEY)).toBe('a');
    expect(cart.moveFailed).toBe(true);
    expect(cart.lastError).toBe('CART_MOVE_FAILED');
    expect(cart.notice).toBeNull();
    expect(cart.checkoutUrl).toBeNull();
  });

  it('a rate limit or a network failure abandons the move the same way', async () => {
    for (const failure of [
      routeError(429, 'TOO_MANY_REQUESTS'),
      Object.assign(new Error('fetch failed'), {}),
    ]) {
      setActivePinia(createPinia());
      vi.resetModules();
      storage.setItem(CART_KEY, 'old');
      storage.setItem(BOUND_KEY, 'a');
      carts.old = cartOf('old', [line('i1', 'v1'), line('i2', 'v2')]);
      pricing.value = signedInAs('b');
      serverFetch.mockReset();
      serverFetch.mockResolvedValueOnce({ id: 'new' }).mockRejectedValueOnce(failure);
      const cart = await store();
      await cart.loadCart();
      expect(cart.cartId).toBe('old');
      expect(cart.moveFailed).toBe(true);
    }
  });

  it('a line refused for good (gone, out of stock) is left behind and counted', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1'), line('i2', 'v2'), line('i3', 'v3')]);
    pricing.value = signedInAs('b', 'Beta hf.');
    serverFetch
      .mockResolvedValueOnce({ id: 'new' })
      .mockRejectedValueOnce(routeError(409, 'CART_INSUFFICIENT_STOCK'))
      .mockRejectedValueOnce(routeError(422, 'PRODUCT_NOT_AVAILABLE'));
    carts.new = cartOf('new', [line('n1', 'v1')]);

    const cart = await store();
    await cart.loadCart();

    expect(cart.cartId).toBe('new');
    expect(cart.notice).toEqual({ reason: 'company', companyName: 'Beta hf.', missing: 2 });
  });

  it('when every line is refused for good, the old cart is let go with a notice', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    pricing.value = signedInAs('b', 'Beta hf.');
    serverFetch.mockRejectedValueOnce(routeError(404, 'NOT_FOUND'));

    const cart = await store();
    await cart.loadCart();

    expect(cart.cartId).toBeNull();
    expect(cart.moveFailed).toBe(false);
    expect(cart.notice).toEqual({ reason: 'company', companyName: 'Beta hf.', missing: 1 });
  });
});

describe('cart store: business login switched off (P3-R8)', () => {
  it('CART_CUSTOMER_PRICES_OFF from a cart route moves the basket to a guest cart', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.g1 = cartOf('g1', [line('g1', 'v1'), line('g2', 'v2')]);
    pricing.value = signedInAs('b');
    serverFetch.mockRejectedValueOnce(routeError(409, 'CART_CUSTOMER_PRICES_OFF'));
    eldra.cart.addItem.mockResolvedValue({ id: 'g1' });

    const cart = await store();
    await cart.addItem('p-v2', 'v2', 1);

    expect(pricing.value.signedIn).toBe(false);
    expect(eldra.cart.addItem).toHaveBeenCalledTimes(2);
    expect(eldra.cart.addItem.mock.calls[1]?.[0]).toMatchObject({ variantId: 'v2', cartId: 'g1' });
    expect(cart.cartId).toBe('g1');
    expect(cart.boundTo).toBeNull();
    expect(cart.notice).toEqual({ reason: 'guest', companyName: null, missing: 0 });
    expect(cart.checkoutUrl).toBe('https://checkout.example/g1');
  });

  it('CART_CUSTOMER_UNAVAILABLE from a cart route moves the basket to a guest cart', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'b');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.g1 = cartOf('g1', [line('g1', 'v1'), line('g2', 'v2')]);
    pricing.value = signedInAs('b');
    serverFetch.mockRejectedValueOnce(routeError(409, 'CART_CUSTOMER_UNAVAILABLE'));
    eldra.cart.addItem.mockResolvedValue({ id: 'g1' });

    const cart = await store();
    await cart.addItem('p-v2', 'v2', 1);

    expect(pricing.value.signedIn).toBe(false);
    expect(cart.cartId).toBe('g1');
    expect(cart.boundTo).toBeNull();
    expect(cart.notice).toEqual({ reason: 'guest', companyName: null, missing: 0 });
  });

  it('CART_CUSTOMER_UNAVAILABLE on a direct guest write moves the company cart too', async () => {
    storage.setItem(CART_KEY, 'old');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.g1 = cartOf('g1', [line('g1', 'v1')]);
    const cart = await store();
    await cart.loadCart();
    eldra.cart.updateItem.mockRejectedValueOnce(gatewayError(409, 'CART_CUSTOMER_UNAVAILABLE'));
    eldra.cart.addItem.mockResolvedValueOnce({ id: 'g1' });
    eldra.cart.updateItem.mockResolvedValueOnce(undefined);

    await cart.updateQuantity('i1', 4);

    expect(cart.cartId).toBe('g1');
    expect(cart.notice?.reason).toBe('guest');
  });

  it('CART_CUSTOMER_PRICES_OFF on a direct guest write moves the company cart too', async () => {
    storage.setItem(CART_KEY, 'old');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.g1 = cartOf('g1', [line('g1', 'v1')]);
    const cart = await store();
    await cart.loadCart();
    eldra.cart.updateItem.mockRejectedValueOnce(gatewayError(409, 'CART_CUSTOMER_PRICES_OFF'));
    eldra.cart.addItem.mockResolvedValueOnce({ id: 'g1' });
    eldra.cart.updateItem.mockResolvedValueOnce(undefined);

    await cart.updateQuantity('i1', 4);

    expect(cart.cartId).toBe('g1');
    expect(eldra.cart.updateItem).toHaveBeenLastCalledWith('g1', 'g1', { quantity: 4 });
    expect(cart.notice?.reason).toBe('guest');
  });
});

describe('cart store: the company is the one the server named (S-M1)', () => {
  it('a company the server could not name is stored as bound, and moved once the company is known', async () => {
    pricing.value = { ...SIGNED_OUT_PRICING, signedIn: true };
    pricedFor = () => 'customer';
    serverFetch.mockResolvedValueOnce({ id: 'c' });
    carts.c = cartOf('c', [line('n1', 'v1')]);
    const cart = await store();
    await cart.addItem('p-v1', 'v1', 1);
    expect(cart.boundTo).toBe('customer');
    expect(cart.discountAllowed).toBe(false);
    expect(cart.checkoutUrl).toBeNull();

    cart.forgetCompanyCart();
    expect(storage.getItem(CART_KEY)).toBeNull();
  });

  it('a company the server named over the browser’s stale one is taken as the active company', async () => {
    pricing.value = signedInAs('c1', 'Acme');
    pricedFor = () => 'c2';
    serverFetch.mockResolvedValueOnce({ id: 'new' });
    carts.new = cartOf('new', [line('n1', 'v1')]);
    const cart = await store();
    await cart.addItem('p-v1', 'v1', 1);
    expect(cart.boundTo).toBe('c2');
    expect(pricing.value.customerId).toBe('c2');
    expect(cart.checkoutUrl).toBe('https://checkout.example/new');
  });
});

describe('cart store: another tab (S-M6)', () => {
  it('follows a cart another tab moved instead of writing to the old one', async () => {
    storage.setItem(CART_KEY, 'old');
    storage.setItem(BOUND_KEY, 'a');
    carts.old = cartOf('old', [line('i1', 'v1')]);
    carts.new = cartOf('new', [line('n1', 'v1')]);
    pricing.value = signedInAs('a');
    const cart = await store();
    await cart.loadCart();

    storage.setItem(CART_KEY, 'new');
    storage.setItem(BOUND_KEY, 'a');
    for (const listener of storageListeners) listener({ key: CART_KEY });
    await cart.loadCart();

    expect(cart.cartId).toBe('new');
    expect(cart.cart?.id).toBe('new');
    expect(cart.checkoutUrl).toBe('https://checkout.example/new');
  });
});
