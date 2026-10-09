import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EldraHttpError, type EldraCustomerMembership } from '@eldrajs/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  PRICED_RESPONSE_HEADERS,
  SIGNED_IN_PAGE_CACHE_CONTROL,
  SIGNED_OUT_PRICING,
  activeCompany,
  addItemInput,
  cartErrorMessageKey,
  cartBindingAction,
  cartNoticeMessage,
  prepareCustomerPricing,
  cartRefusal,
  catalogKey,
  chosenCompany,
  pageSizeOf,
  pricedContext,
  pricedFailure,
  quantityOf,
  routeErrorOf,
  runPriced,
  selectableCompanies,
  type PricedCaller,
  type PricedRun,
} from '../../shared/utils/customer-prices';

const problem = (status: number, errorId?: string, code = 'X') =>
  new EldraHttpError(new Response(null, { status }), { code, ...(errorId ? { errorId } : {}) });

const caller: PricedCaller = { accessToken: 'tok', orgId: 'org-uuid', customerId: 'c1' };

const membership = (
  customerId: string,
  status: 'ACTIVE' | 'INVITED' = 'ACTIVE'
): EldraCustomerMembership =>
  ({
    customerId,
    customerName: customerId,
    number: '1',
    role: 'BUYER',
    status,
  }) as EldraCustomerMembership;

function harness(
  call: PricedRun<string>['call'],
  overrides: Partial<PricedRun<string>> = {}
): PricedRun<string> & { headers: Record<string, string>[] } {
  const headers: Record<string, string>[] = [];
  return {
    kind: 'read',
    caller,
    setHeaders: (h) => headers.push(h),
    call,
    endSession: vi.fn(async () => {}),
    dropCompany: vi.fn(async () => {}),
    headers,
    ...overrides,
  };
}

describe('pricedContext', () => {
  it('sends the token, the active company and the organization UUID', () => {
    expect(pricedContext(caller)).toEqual({
      orgId: 'org-uuid',
      headers: { Authorization: 'Bearer tok', 'X-Customer-Id': 'c1' },
    });
  });

  it('leaves X-Customer-Id out when no company is chosen', () => {
    expect(pricedContext({ ...caller, customerId: null })?.headers).toEqual({
      Authorization: 'Bearer tok',
    });
  });

  it('never sends Authorization without a token: a guest has no context at all', () => {
    expect(pricedContext(null)).toBeUndefined();
    expect(pricedContext({ ...caller, accessToken: '' })).toBeUndefined();
  });
});

describe('pricedFailure', () => {
  it('ends the session on FEATURE_DISABLED and on 401', () => {
    expect(pricedFailure(problem(403, 'FEATURE_DISABLED'), 'read')).toBe('end-session');
    expect(pricedFailure(problem(403, 'FEATURE_DISABLED'), 'write')).toBe('end-session');
    expect(pricedFailure(problem(401, 'SHOP_TOKEN_INVALID'), 'read')).toBe('end-session');
  });

  it('drops a company the person no longer belongs to', () => {
    expect(pricedFailure(problem(403, 'SHOP_CUSTOMER_NOT_MEMBER'), 'read')).toBe('drop-company');
  });

  it('reads as a guest without a company, but a cart write needs the choice', () => {
    expect(pricedFailure(problem(403, 'SHOP_NO_MEMBERSHIP'), 'read')).toBe('guest');
    expect(pricedFailure(problem(409, 'SHOP_CUSTOMER_REQUIRED'), 'read')).toBe('guest');
    expect(pricedFailure(problem(409, 'SHOP_CUSTOMER_REQUIRED'), 'write')).toBe('throw');
  });

  it('never falls back to list prices on an outage or an unknown refusal', () => {
    expect(pricedFailure(problem(503, 'CUSTOMER_PRICES_UNAVAILABLE'), 'read')).toBe('throw');
    expect(pricedFailure(problem(503, 'SHOP_LOGIN_UNAVAILABLE'), 'read')).toBe('throw');
    expect(pricedFailure(problem(403), 'read')).toBe('throw');
    expect(pricedFailure(problem(409, 'CART_CUSTOMER_MISMATCH'), 'write')).toBe('throw');
    expect(pricedFailure(new Error('boom'), 'read')).toBe('throw');
  });
});

describe('runPriced', () => {
  it('sets private, no-store before calling, on success', async () => {
    const run = harness(async () => 'priced');
    await expect(runPriced(run)).resolves.toBe('priced');
    expect(run.headers[0]).toEqual({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  });

  it('sets private, no-store on a guest call and on a failure too', async () => {
    const guest = harness(async () => 'list', { caller: null });
    await runPriced(guest);
    expect(guest.headers[0]?.['Cache-Control']).toBe('private, no-store');

    const failing = harness(async () => {
      throw problem(503, 'CUSTOMER_PRICES_UNAVAILABLE');
    });
    await expect(runPriced(failing)).rejects.toBeInstanceOf(EldraHttpError);
    expect(failing.headers[0]?.['Cache-Control']).toBe('private, no-store');
  });

  it('calls a guest with no context', async () => {
    const call = vi.fn(async () => 'list');
    await runPriced(harness(call, { caller: null }));
    expect(call).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('on FEATURE_DISABLED ends the session and retries once as a guest', async () => {
    const call = vi
      .fn<PricedRun<string>['call']>()
      .mockRejectedValueOnce(problem(403, 'FEATURE_DISABLED'))
      .mockResolvedValueOnce('list');
    const run = harness(call);
    await expect(runPriced(run)).resolves.toBe('list');
    expect(run.endSession).toHaveBeenCalledExactlyOnceWith({ featureDisabled: true });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]?.[0]?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(call.mock.calls[1]?.[0]).toBeUndefined();
  });

  it('retries as a guest only once: a second failure is thrown', async () => {
    const call = vi
      .fn<PricedRun<string>['call']>()
      .mockRejectedValueOnce(problem(403, 'FEATURE_DISABLED'))
      .mockRejectedValueOnce(problem(403, 'FEATURE_DISABLED'));
    const run = harness(call);
    await expect(runPriced(run)).rejects.toBeInstanceOf(EldraHttpError);
    expect(call).toHaveBeenCalledTimes(2);
    expect(run.endSession).toHaveBeenCalledTimes(1);
  });

  it('on 401 ends the session without treating it as B2B off', async () => {
    const call = vi
      .fn<PricedRun<string>['call']>()
      .mockRejectedValueOnce(problem(401, 'SHOP_TOKEN_INVALID'))
      .mockResolvedValueOnce('list');
    const run = harness(call);
    await runPriced(run);
    expect(run.endSession).toHaveBeenCalledWith({ featureDisabled: false });
  });

  it('forgets a stale company and retries once without it, still signed in', async () => {
    const call = vi
      .fn<PricedRun<string>['call']>()
      .mockRejectedValueOnce(problem(403, 'SHOP_CUSTOMER_NOT_MEMBER'))
      .mockResolvedValueOnce('priced');
    const run = harness(call);
    await expect(runPriced(run)).resolves.toBe('priced');
    expect(run.dropCompany).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[1]?.[0]?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('after dropping a stale company, a read that must choose a company falls back to a guest call', async () => {
    const call = vi
      .fn<PricedRun<string>['call']>()
      .mockRejectedValueOnce(problem(403, 'SHOP_CUSTOMER_NOT_MEMBER'))
      .mockRejectedValueOnce(problem(409, 'SHOP_CUSTOMER_REQUIRED'))
      .mockResolvedValueOnce('list');
    const run = harness(call);
    await expect(runPriced(run)).resolves.toBe('list');
    expect(run.dropCompany).toHaveBeenCalledTimes(1);
    expect(run.endSession).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[1]?.[0]?.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(call.mock.calls[2]?.[0]).toBeUndefined();
  });

  it('after dropping a stale company, a write that must choose a company is refused', async () => {
    const call = vi
      .fn<PricedRun<string>['call']>()
      .mockRejectedValueOnce(problem(403, 'SHOP_CUSTOMER_NOT_MEMBER'))
      .mockRejectedValueOnce(problem(409, 'SHOP_CUSTOMER_REQUIRED'));
    const run = harness(call, { kind: 'write' });
    await expect(runPriced(run)).rejects.toMatchObject({ errorId: 'SHOP_CUSTOMER_REQUIRED' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('reads as a guest when the person must still choose a company, keeping the session', async () => {
    const call = vi
      .fn<PricedRun<string>['call']>()
      .mockRejectedValueOnce(problem(409, 'SHOP_CUSTOMER_REQUIRED'))
      .mockResolvedValueOnce('list');
    const run = harness(call, { caller: { ...caller, customerId: null } });
    await expect(runPriced(run)).resolves.toBe('list');
    expect(run.endSession).not.toHaveBeenCalled();
    expect(call.mock.calls[1]?.[0]).toBeUndefined();
  });

  it('passes cart refusals on unchanged', async () => {
    const run = harness(
      async () => {
        throw problem(409, 'CART_CUSTOMER_MISMATCH');
      },
      { kind: 'write' }
    );
    await expect(runPriced(run)).rejects.toMatchObject({ errorId: 'CART_CUSTOMER_MISMATCH' });
    expect(run.endSession).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('pins private, no-store for priced answers and signed-in pages', () => {
    expect(PRICED_RESPONSE_HEADERS['Cache-Control']).toBe('private, no-store');
    expect(SIGNED_IN_PAGE_CACHE_CONTROL).toBe('private, no-store');
  });

  // Every priced route goes through pricedCall, which sets the headers before anything can fail.
  it('every catalog and cart server route goes through pricedCall', () => {
    const root = join(import.meta.dirname, '../../server/api');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(join(root, 'catalog'));
    walk(join(root, 'cart'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toMatch(/pricedCall\(event, '(read|write)'/);
      expect(source, file).not.toMatch(/defineCachedEventHandler|cachedFunction/);
    }
  });

  it('keys a signed-in payload per company and leaves a guest key unchanged', () => {
    expect(catalogKey('product:en-US:mug', SIGNED_OUT_PRICING)).toBe('product:en-US:mug');
    const a = catalogKey('product:en-US:mug', {
      ...SIGNED_OUT_PRICING,
      signedIn: true,
      customerId: 'a',
    });
    const b = catalogKey('product:en-US:mug', {
      ...SIGNED_OUT_PRICING,
      signedIn: true,
      customerId: 'b',
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe('product:en-US:mug');
    expect(catalogKey('p', { ...SIGNED_OUT_PRICING, signedIn: true, needsCompany: true })).not.toBe(
      catalogKey('p', { ...SIGNED_OUT_PRICING, signedIn: true })
    );
  });
});

describe('routeErrorOf', () => {
  it('passes the gateway status and reason, never the message', () => {
    expect(routeErrorOf(problem(409, 'CART_SIGN_IN_REQUIRED', 'CONFLICT'))).toEqual({
      statusCode: 409,
      data: { errorId: 'CART_SIGN_IN_REQUIRED', code: 'CONFLICT' },
    });
  });

  it('answers 502 for anything without a status', () => {
    expect(routeErrorOf(new Error('secret detail'))).toEqual({ statusCode: 502, data: {} });
  });
});

describe('active company', () => {
  const two = [membership('a'), membership('b', 'INVITED')];

  it('keeps a stored choice while it is still one of the companies', () => {
    expect(activeCompany('b', two)).toEqual({ kind: 'chosen', customerId: 'b' });
  });

  it('defaults to the only company', () => {
    expect(activeCompany(null, [membership('a')])).toEqual({ kind: 'only', customerId: 'a' });
    expect(activeCompany('gone', [membership('a')])).toEqual({ kind: 'only', customerId: 'a' });
  });

  it('asks to choose among several, and has none without memberships', () => {
    expect(activeCompany(null, two)).toEqual({ kind: 'choose' });
    expect(activeCompany('gone', two)).toEqual({ kind: 'choose' });
    expect(activeCompany(null, [])).toEqual({ kind: 'none' });
    expect(activeCompany(null, null)).toEqual({ kind: 'none' });
  });

  it('lists only memberships the gateway accepts', () => {
    const odd = { ...membership('x'), status: 'REMOVED' } as unknown as EldraCustomerMembership;
    expect(selectableCompanies([...two, odd]).map((m) => m.customerId)).toEqual(['a', 'b']);
  });

  it('accepts a chosen company only when it is one of the person’s', () => {
    expect(chosenCompany({ customerId: 'a' }, two)).toBe('a');
    expect(chosenCompany({ customerId: 'other' }, two)).toBeNull();
    expect(chosenCompany({ customerId: ['a'] }, two)).toBeNull();
    expect(chosenCompany(null, two)).toBeNull();
  });
});

describe('cart refusals', () => {
  it('starts a new cart for a cart bound elsewhere', () => {
    expect(cartRefusal('CART_CUSTOMER_MISMATCH')).toBe('new-cart-other-company');
    expect(cartRefusal('CART_SIGN_IN_REQUIRED')).toBe('new-cart-sign-in');
  });

  it('maps the other customer-price refusals', () => {
    expect(cartRefusal('SHOP_CUSTOMER_REQUIRED')).toBe('company-required');
    expect(cartRefusal('CART_PRICES_UNAVAILABLE')).toBe('prices-unavailable');
    expect(cartRefusal('CART_DISCOUNT_NOT_FOR_CUSTOMER_PRICES')).toBe(
      'discount-not-for-customer-prices'
    );
    expect(cartRefusal('CART_INSUFFICIENT_STOCK')).toBe('out-of-stock');
    expect(cartRefusal(undefined)).toBeNull();
    expect(cartRefusal('CART_NOT_FOUND')).toBeNull();
  });

  it('turns store errors and notices into message keys', () => {
    expect(cartErrorMessageKey('COMPANY_REQUIRED', 'addFailed')).toBe('companyRequired');
    expect(cartErrorMessageKey('PRICES_UNAVAILABLE', 'addFailed')).toBe('pricesUnavailable');
    expect(cartErrorMessageKey('DISCOUNT_NOT_FOR_CUSTOMER_PRICES', 'codeRejected')).toBe(
      'discountNotForCompanyPrices'
    );
    expect(cartErrorMessageKey(null, 'addFailed')).toBe('addFailed');
    expect(cartNoticeMessage({ reason: 'company', companyName: 'Acme', missing: 0 })).toEqual({
      key: 'cartMovedToCompany',
      params: { company: 'Acme', missing: 0 },
    });
    expect(cartNoticeMessage({ reason: 'company', companyName: 'Acme', missing: 2 })?.key).toBe(
      'cartMovedToCompanyMissing'
    );
    expect(cartNoticeMessage({ reason: 'company', companyName: null, missing: 0 })?.key).toBe(
      'cartMovedToYourCompany'
    );
    expect(cartNoticeMessage({ reason: 'guest', companyName: null, missing: 1 })?.key).toBe(
      'cartMovedToGuestMissing'
    );
    expect(cartNoticeMessage(null)).toBeNull();
  });

  it('message keys exist in both locales', () => {
    const en = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../i18n/locales/en-US.json'), 'utf8')
    ) as Record<string, string>;
    for (const key of [
      'companyRequired',
      'pricesUnavailable',
      'discountNotForCompanyPrices',
      'cartMovedToCompany',
      'cartMovedToCompanyMissing',
      'cartMovedToYourCompany',
      'cartMovedToYourCompanyMissing',
      'cartMovedToGuest',
      'cartMovedToGuestMissing',
      'cartMoveFailed',
      'companyPrice',
      'listPrice',
    ])
      expect(en[key], key).toBeTruthy();
  });
});

describe('request parsing', () => {
  it('forwards only a valid add-to-cart body', () => {
    expect(
      addItemInput({ productId: 'p', variantId: 'v', quantity: 2, cartId: 'c', extra: 'x' })
    ).toEqual({ productId: 'p', variantId: 'v', quantity: 2, cartId: 'c' });
    expect(addItemInput({ productId: 'p', variantId: 'v', quantity: 1 })).toEqual({
      productId: 'p',
      variantId: 'v',
      quantity: 1,
    });
    expect(addItemInput({ productId: 'p', variantId: 'v', quantity: 0 })).toBeNull();
    expect(addItemInput({ productId: 'p', quantity: 1 })).toBeNull();
    expect(addItemInput({ productId: 'p', variantId: 'v', quantity: 1, cartId: 5 })).toBeNull();
    expect(addItemInput(null)).toBeNull();
  });

  it('checks quantities and page sizes', () => {
    expect(quantityOf({ quantity: 3 })).toBe(3);
    expect(quantityOf({ quantity: 1.5 })).toBeNull();
    expect(quantityOf({ quantity: '3' })).toBeNull();
    expect(pageSizeOf('8')).toBe(8);
    expect(pageSizeOf('500')).toBe(100);
    expect(pageSizeOf(undefined)).toBe(100);
    expect(pageSizeOf('-1')).toBe(100);
  });
});

describe('cartBindingAction', () => {
  const signedIn = (customerId: string | null, needsCompany = false) => ({
    ...SIGNED_OUT_PRICING,
    signedIn: true,
    customerId,
    needsCompany,
  });

  it('keeps the buyer’s own cart, and a guest cart for a guest', () => {
    expect(cartBindingAction('a', signedIn('a'), true)).toBe('keep');
    expect(cartBindingAction(null, SIGNED_OUT_PRICING, true)).toBe('keep');
  });

  it('moves another company’s cart, and a guest cart with lines once signed in', () => {
    expect(cartBindingAction('a', signedIn('b'), true)).toBe('move');
    expect(cartBindingAction('a', signedIn('b'), false)).toBe('move');
    expect(cartBindingAction(null, signedIn('b'), true)).toBe('move');
    expect(cartBindingAction(null, signedIn('b'), false)).toBe('keep');
  });

  it('forgets a company cart on a signed-out browser', () => {
    expect(cartBindingAction('a', SIGNED_OUT_PRICING, true)).toBe('forget');
  });

  it('waits while no company is chosen', () => {
    expect(cartBindingAction('a', signedIn(null, true), true)).toBe('wait');
  });
});

describe('prepareCustomerPricing (the pricing plugin)', () => {
  const state = { ...SIGNED_OUT_PRICING, signedIn: true, customerId: 'c1', customerName: 'Acme' };

  it('sends a page rendered for a session cookie private, no-store, before reading the state', async () => {
    const order: string[] = [];
    const result = await prepareCustomerPricing({
      businessLogin: true,
      hasSessionCookie: true,
      setCacheControl: (value) => order.push(`header:${value}`),
      fetchState: async () => {
        order.push('fetch');
        return state;
      },
    });
    expect(order).toEqual(['header:private, no-store', 'fetch']);
    expect(result).toEqual(state);
  });

  it('keeps no-store when the state cannot be read, and answers signed out', async () => {
    const setCacheControl = vi.fn();
    const result = await prepareCustomerPricing({
      businessLogin: true,
      hasSessionCookie: true,
      setCacheControl,
      fetchState: async () => {
        throw new Error('down');
      },
    });
    expect(setCacheControl).toHaveBeenCalledWith('private, no-store');
    expect(result).toEqual(SIGNED_OUT_PRICING);
  });

  it('leaves a guest’s page alone', async () => {
    for (const deps of [
      { businessLogin: true, hasSessionCookie: false },
      { businessLogin: false, hasSessionCookie: true },
    ]) {
      const setCacheControl = vi.fn();
      const fetchState = vi.fn();
      await expect(
        prepareCustomerPricing({ ...deps, setCacheControl, fetchState })
      ).resolves.toEqual(SIGNED_OUT_PRICING);
      expect(setCacheControl).not.toHaveBeenCalled();
      expect(fetchState).not.toHaveBeenCalled();
    }
  });
});
