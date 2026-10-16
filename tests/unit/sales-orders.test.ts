import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EldraHttpError } from '@eldrajs/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { PricedCaller } from '../../shared/utils/customer-prices';
import {
  paymentTermText,
  CHECKOUT_ATTEMPT_KEY,
  NOTE_MAX_LENGTH,
  ORDER_PAGE_SIZE,
  PO_NUMBER_MAX_LENGTH,
  SALES_ORDER_STATUSES,
  attemptAfter,
  attemptFingerprint,
  attemptFor,
  businessContext,
  companyGoneMessage,
  createPreviewSequence,
  latestAnswer,
  readRefusal,
  refreshesPreview,
  createOrderInput,
  idempotencyKeyOf,
  orderListQuery,
  placedByLabel,
  previewInput,
  readAttempt,
  reorderLines,
  runBusiness,
  salesOrderIdOf,
  salesOrderRefusal,
  salesStatusKey,
  type BusinessRun,
  type CheckoutAttempt,
} from '../../shared/utils/sales-orders';
import { SIGNED_OUT_PRICING } from '../../shared/utils/customer-prices';

const problem = (status: number, errorId?: string, errors?: Record<string, unknown>) =>
  new EldraHttpError(new Response(null, { status }), {
    code: 'X',
    ...(errorId ? { errorId } : {}),
    ...(errors ? { errors } : {}),
  });

const caller: PricedCaller = { accessToken: 'tok', orgId: 'org-uuid', customerId: 'c1' };
const CART = '7a1d6c0e-3f7b-4c55-9b5e-0d6f3c1c9a10';
const LOCATION = '0b0c7a55-2f87-4c86-8f43-8bd4b8a2a111';

function harness(
  call: BusinessRun<string>['call'],
  overrides: Partial<BusinessRun<string>> = {}
): BusinessRun<string> & { headers: Record<string, string>[] } {
  const headers: Record<string, string>[] = [];
  return {
    caller,
    setHeaders: (h) => headers.push(h),
    call,
    endSession: vi.fn(async () => {}),
    dropCompany: vi.fn(async () => {}),
    companyCount: vi.fn(async () => 1),
    headers,
    ...overrides,
  };
}

describe('businessContext', () => {
  it('sends the token, the active company and the organization UUID', () => {
    expect(businessContext(caller)).toEqual({
      orgId: 'org-uuid',
      headers: { Authorization: 'Bearer tok', 'X-Customer-Id': 'c1' },
    });
  });

  it('is null without a token or without a company: never a call without either', () => {
    expect(businessContext(null)).toBeNull();
    expect(businessContext({ ...caller, accessToken: '' })).toBeNull();
    expect(businessContext({ ...caller, customerId: null })).toBeNull();
  });
});

describe('runBusiness', () => {
  it('sets private, no-store before calling, and calls with the token and the active company', async () => {
    const call = vi.fn(async () => 'order');
    const run = harness(call);
    await expect(runBusiness(run)).resolves.toBe('order');
    expect(run.headers[0]).toEqual({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
    expect(call).toHaveBeenCalledExactlyOnceWith({
      orgId: 'org-uuid',
      headers: { Authorization: 'Bearer tok', 'X-Customer-Id': 'c1' },
    });
  });

  it('without a session answers 401 and never calls the gateway (no Authorization at all)', async () => {
    const call = vi.fn(async () => 'order');
    for (const who of [null, { ...caller, accessToken: '' }]) {
      const run = harness(call, { caller: who });
      await expect(runBusiness(run)).rejects.toMatchObject({
        status: 401,
        errorId: 'SHOP_TOKEN_INVALID',
      });
      expect(run.headers[0]?.['Cache-Control']).toBe('private, no-store');
    }
    expect(call).not.toHaveBeenCalled();
  });

  it('without an active company answers 409 SHOP_CUSTOMER_REQUIRED and never calls', async () => {
    const call = vi.fn(async () => 'order');
    await expect(
      runBusiness(harness(call, { caller: { ...caller, customerId: null } }))
    ).rejects.toMatchObject({ status: 409, errorId: 'SHOP_CUSTOMER_REQUIRED' });
    expect(call).not.toHaveBeenCalled();
  });

  it('never retries as a guest or for another company', async () => {
    for (const error of [
      problem(401, 'SHOP_TOKEN_INVALID'),
      problem(403, 'FEATURE_DISABLED'),
      problem(403, 'SHOP_CUSTOMER_NOT_MEMBER'),
      problem(409, 'ORDER_CUSTOMER_UNAVAILABLE'),
      problem(409, 'CUSTOMER_BLOCKED'),
    ]) {
      const call = vi.fn<BusinessRun<string>['call']>().mockRejectedValue(error);
      await expect(runBusiness(harness(call))).rejects.toBe(error);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it('ends the session on 401 and on FEATURE_DISABLED (B2B off)', async () => {
    const unauthorized = harness(async () => {
      throw problem(401, 'SHOP_TOKEN_INVALID');
    });
    await expect(runBusiness(unauthorized)).rejects.toMatchObject({ status: 401 });
    expect(unauthorized.endSession).toHaveBeenCalledExactlyOnceWith({ featureDisabled: false });

    const off = harness(async () => {
      throw problem(403, 'FEATURE_DISABLED');
    });
    await expect(runBusiness(off)).rejects.toMatchObject({ status: 403 });
    expect(off.endSession).toHaveBeenCalledExactlyOnceWith({ featureDisabled: true });
  });

  it('ORDER_CUSTOMER_PRICES_OFF ends the session as B2B off', async () => {
    const run = harness(async () => {
      throw problem(409, 'ORDER_CUSTOMER_PRICES_OFF');
    });
    await expect(runBusiness(run)).rejects.toMatchObject({ errorId: 'ORDER_CUSTOMER_PRICES_OFF' });
    expect(run.endSession).toHaveBeenCalledExactlyOnceWith({ featureDisabled: true });
  });

  it('ORDER_CUSTOMER_UNAVAILABLE drops only that company for a person with several', async () => {
    const run = harness(
      async () => {
        throw problem(409, 'ORDER_CUSTOMER_UNAVAILABLE');
      },
      { companyCount: vi.fn(async () => 2) }
    );
    await expect(runBusiness(run)).rejects.toMatchObject({ errorId: 'ORDER_CUSTOMER_UNAVAILABLE' });
    expect(run.dropCompany).toHaveBeenCalledTimes(1);
    expect(run.endSession).not.toHaveBeenCalled();
  });

  it('ORDER_CUSTOMER_UNAVAILABLE ends the session for a person with one company', async () => {
    const run = harness(async () => {
      throw problem(409, 'ORDER_CUSTOMER_UNAVAILABLE');
    });
    await expect(runBusiness(run)).rejects.toMatchObject({ errorId: 'ORDER_CUSTOMER_UNAVAILABLE' });
    expect(run.endSession).toHaveBeenCalledExactlyOnceWith({ featureDisabled: false });
    expect(run.dropCompany).not.toHaveBeenCalled();
  });

  it('when the companies cannot be counted, the session ends as before', async () => {
    const run = harness(
      async () => {
        throw problem(409, 'ORDER_CUSTOMER_UNAVAILABLE');
      },
      {
        companyCount: vi.fn(async () => {
          throw new Error('me down');
        }),
      }
    );
    await expect(runBusiness(run)).rejects.toMatchObject({ errorId: 'ORDER_CUSTOMER_UNAVAILABLE' });
    expect(run.endSession).toHaveBeenCalledTimes(1);
  });

  it('forgets a company the person no longer belongs to, keeping the session', async () => {
    const run = harness(async () => {
      throw problem(403, 'SHOP_CUSTOMER_NOT_MEMBER');
    });
    await expect(runBusiness(run)).rejects.toMatchObject({ status: 403 });
    expect(run.dropCompany).toHaveBeenCalledTimes(1);
    expect(run.endSession).not.toHaveBeenCalled();
  });

  it('a 502 SALES_ORDER_UPSTREAM_REFUSED or an outage never ends the session', async () => {
    for (const error of [
      problem(502, 'SALES_ORDER_UPSTREAM_REFUSED'),
      problem(503, 'SALES_ORDER_TERMS_UNAVAILABLE'),
      problem(409, 'SALES_ORDER_CREDIT_LIMIT_EXCEEDED'),
      new Error('timeout'),
    ]) {
      const run = harness(async () => {
        throw error;
      });
      await expect(runBusiness(run)).rejects.toBe(error);
      expect(run.endSession).not.toHaveBeenCalled();
      expect(run.dropCompany).not.toHaveBeenCalled();
    }
  });
});

describe('every sales-order and location route', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) files.push(path);
    }
  };
  const root = join(import.meta.dirname, '../../server/api');
  walk(join(root, 'sales-orders'));
  walk(join(root, 'customer'));

  it('goes through businessCall, POSTs as writes (same-origin only), and is never cached', () => {
    expect(files.length).toBe(5);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const kind = file.endsWith('.post.ts') ? 'write' : 'read';
      expect(source, file).toMatch(new RegExp(`businessCall\\(event, '${kind}'`));
      if (kind === 'write') {
        // Another site is refused (403) before its body is read or judged.
        const origin = source.indexOf('await requireSameOriginWrite(event)');
        expect(origin, file).toBeGreaterThan(-1);
        expect(origin, file).toBeLessThan(source.indexOf('readBody('));
      }
      expect(source, file).not.toMatch(/defineCachedEventHandler|cachedFunction/);
    }
  });
});

describe('request bodies', () => {
  it('preview takes only a cart id and an optional location', () => {
    expect(previewInput({ cartId: CART })).toEqual({ cartId: CART });
    expect(previewInput({ cartId: CART, locationId: LOCATION, customerId: 'x' })).toEqual({
      cartId: CART,
      locationId: LOCATION,
    });
    expect(previewInput({ cartId: CART, locationId: '' })).toEqual({ cartId: CART });
    expect(previewInput({})).toBeNull();
    expect(previewInput({ cartId: 'not an id' })).toBeNull();
    expect(previewInput({ cartId: CART, locationId: 'x/../y' })).toBeNull();
    expect(previewInput(null)).toBeNull();
  });

  it('create keeps the known fields, trimmed, and refuses over-long or malformed ones', () => {
    expect(
      createOrderInput({
        cartId: CART,
        locationId: LOCATION,
        purchaseOrderNumber: '  PO-1  ',
        customerOrderDate: '2026-10-10',
        note: ' Back door ',
        unitPrice: 1,
        customerId: 'other',
      })
    ).toEqual({
      cartId: CART,
      locationId: LOCATION,
      purchaseOrderNumber: 'PO-1',
      customerOrderDate: '2026-10-10',
      note: 'Back door',
    });
    expect(createOrderInput({ cartId: CART, purchaseOrderNumber: '', note: '   ' })).toEqual({
      cartId: CART,
    });
    expect(
      createOrderInput({ cartId: CART, purchaseOrderNumber: 'x'.repeat(PO_NUMBER_MAX_LENGTH + 1) })
    ).toBeNull();
    expect(createOrderInput({ cartId: CART, note: 'x'.repeat(NOTE_MAX_LENGTH + 1) })).toBeNull();
    expect(createOrderInput({ cartId: CART, note: 'x'.repeat(NOTE_MAX_LENGTH) })).not.toBeNull();
    expect(createOrderInput({ cartId: CART, customerOrderDate: '2026-02-30' })).toBeNull();
    expect(createOrderInput({ cartId: CART, customerOrderDate: '10.10.2026' })).toBeNull();
    expect(createOrderInput({ cartId: CART, note: 5 })).toBeNull();
  });

  it('the idempotency key is required, at most 255 visible characters', () => {
    expect(idempotencyKeyOf('a1b2')).toBe('a1b2');
    expect(idempotencyKeyOf(undefined)).toBeNull();
    expect(idempotencyKeyOf('   ')).toBeNull();
    expect(idempotencyKeyOf('x'.repeat(256))).toBeNull();
    expect(idempotencyKeyOf('x'.repeat(255))).toBe('x'.repeat(255));
    expect(idempotencyKeyOf('a\nb')).toBeNull();
  });

  it('the history query pages within 1–50 and filters by a known status only', () => {
    expect(orderListQuery({})).toEqual({ page: 1, pageSize: ORDER_PAGE_SIZE });
    expect(orderListQuery({ page: '3', pageSize: '500', status: 'OPEN' })).toEqual({
      page: 3,
      pageSize: 50,
      status: 'OPEN',
    });
    expect(orderListQuery({ page: '-1', status: 'open; drop' })).toEqual({
      page: 1,
      pageSize: ORDER_PAGE_SIZE,
    });
  });
});

describe('salesOrderRefusal', () => {
  it('a blocked company and the credit limit get their own messages, never figures', () => {
    expect(salesOrderRefusal(problem(409, 'CUSTOMER_BLOCKED'))).toEqual({
      action: 'show',
      message: 'salesOrderBlocked',
    });
    expect(
      salesOrderRefusal(
        problem(409, 'SALES_ORDER_CREDIT_LIMIT_EXCEEDED', { limit: 1, exposure: 2 })
      )
    ).toEqual({ action: 'show', message: 'salesOrderCreditLimit' });
  });

  it('a company that can no longer buy at its prices moves the person to a guest cart', () => {
    expect(salesOrderRefusal(problem(409, 'ORDER_CUSTOMER_PRICES_OFF'))).toEqual({
      action: 'to-guest',
      message: 'salesOrderCompanyUnavailable',
    });
    // An unavailable company says nothing about list prices until who is buying is known again.
    expect(salesOrderRefusal(problem(409, 'ORDER_CUSTOMER_UNAVAILABLE'))).toEqual({
      action: 'to-guest',
      message: 'salesOrderCompanyGone',
    });
  });

  it('after re-reading who is buying, the message says what happened to the cart', () => {
    const signedOut = { ...SIGNED_OUT_PRICING };
    const choosing = { ...SIGNED_OUT_PRICING, signedIn: true, needsCompany: true };
    const buying = { ...SIGNED_OUT_PRICING, signedIn: true, customerId: 'c2' };
    for (const message of ['salesOrderCompanyGone', 'salesOrderCompanyUnavailable']) {
      expect(companyGoneMessage(message, choosing)).toBe('salesOrderCompanyChooseAnother');
      expect(companyGoneMessage(message, signedOut)).toBe('salesOrderCompanyUnavailable');
      expect(companyGoneMessage(message, buying)).toBe(message);
    }
  });

  it('names the items that are no longer sold', () => {
    const routeError = Object.assign(new Error('FetchError'), {
      data: {
        statusCode: 409,
        data: { errorId: 'ORDER_PRODUCT_UNAVAILABLE', variantIds: ['v1', 'v2'] },
      },
    });
    expect(salesOrderRefusal(routeError)).toEqual({
      action: 'show',
      message: 'salesOrderProductUnavailable',
      variantIds: ['v1', 'v2'],
    });
    expect(
      salesOrderRefusal(problem(409, 'ORDER_PRODUCT_UNAVAILABLE', { variantIds: ['v3', 7] }))
    ).toEqual({ action: 'show', message: 'salesOrderProductUnavailable', variantIds: ['v3'] });
  });

  it('explicit messages for a missing order, an unregistered site and services down', () => {
    expect(salesOrderRefusal(problem(404, 'SALES_ORDER_NOT_FOUND'))).toEqual({
      action: 'show',
      message: 'orderNotFound',
    });
    expect(salesOrderRefusal(problem(403, 'ORIGIN_NOT_REGISTERED'))).toEqual({
      action: 'show',
      message: 'salesOrderOriginNotRegistered',
    });
    expect(salesOrderRefusal(problem(503, 'SALES_ORDER_CART_UNAVAILABLE'))).toEqual({
      action: 'retry',
      message: 'salesOrderCartUnavailable',
    });
    expect(salesOrderRefusal(problem(503, 'SHOP_LOGIN_UNAVAILABLE'))).toEqual({
      action: 'retry',
      message: 'salesOrderLoginUnavailable',
    });
  });

  it('a credit or blocked refusal of a create re-runs the preview, so it decides what may be placed', () => {
    const blocked = salesOrderRefusal(problem(409, 'CUSTOMER_BLOCKED'));
    const credit = salesOrderRefusal(problem(409, 'SALES_ORDER_CREDIT_LIMIT_EXCEEDED'));
    expect(refreshesPreview(blocked, 'create')).toBe(true);
    expect(refreshesPreview(credit, 'create')).toBe(true);
    expect(
      refreshesPreview(salesOrderRefusal(problem(502, 'SALES_ORDER_UPSTREAM_REFUSED')), 'create')
    ).toBe(false);
  });

  it('a refused preview never asks for another preview (a blocked customer must not loop)', () => {
    for (const id of ['CUSTOMER_BLOCKED', 'SALES_ORDER_CREDIT_LIMIT_EXCEEDED']) {
      expect(refreshesPreview(salesOrderRefusal(problem(409, id)), 'preview')).toBe(false);
    }
  });

  it('credit kept in another currency is its own message, with no figures, and re-previews once', () => {
    const refusal = salesOrderRefusal(
      problem(409, 'SALES_ORDER_CREDIT_CURRENCY_MISMATCH', { limit: 1, currency: 'EUR' })
    );
    expect(refusal).toEqual({ action: 'show', message: 'salesOrderCreditCurrencyMismatch' });
    expect(refreshesPreview(refusal, 'create')).toBe(true);
    expect(refreshesPreview(refusal, 'preview')).toBe(false);
  });

  it('a cart not bound to the company is re-bound by replaying its lines', () => {
    expect(salesOrderRefusal(problem(409, 'SALES_ORDER_CART_NOT_BOUND'))).toEqual({
      action: 'rebind',
      message: 'salesOrderCartRebound',
    });
  });

  it('a cart already ordered opens that order', () => {
    const routeError = Object.assign(new Error('FetchError'), {
      data: {
        statusCode: 409,
        data: { errorId: 'SALES_ORDER_CART_ALREADY_ORDERED', salesOrderId: 'so-1' },
      },
    });
    expect(salesOrderRefusal(routeError)).toEqual({ action: 'open-order', salesOrderId: 'so-1' });
    expect(
      salesOrderRefusal(problem(409, 'SALES_ORDER_CART_ALREADY_ORDERED', { salesOrderId: 'so-2' }))
    ).toEqual({ action: 'open-order', salesOrderId: 'so-2' });
    // Without the id there is nothing to open: say it was placed and point at the history.
    expect(salesOrderRefusal(problem(409, 'SALES_ORDER_CART_ALREADY_ORDERED'))).toEqual({
      action: 'show',
      message: 'salesOrderAlreadyOrdered',
    });
  });

  it('only 401 means sign in again; 502 UPSTREAM_REFUSED, 503s and no answer are retried', () => {
    expect(salesOrderRefusal(problem(401, 'SHOP_TOKEN_INVALID'))).toEqual({
      action: 'sign-in',
      message: 'salesOrderSignIn',
    });
    for (const error of [
      problem(502, 'SALES_ORDER_UPSTREAM_REFUSED'),
      problem(503),
      problem(500),
      problem(429),
      new Error('network'),
    ]) {
      expect(salesOrderRefusal(error)).toEqual({ action: 'retry', message: 'salesOrderRetry' });
    }
  });

  it('terms and credit checks that cannot be made now say so', () => {
    for (const id of [
      'SALES_ORDER_TERMS_UNAVAILABLE',
      'SALES_ORDER_CREDIT_CHECK_UNAVAILABLE',
      'ORDER_PRICES_UNAVAILABLE',
    ]) {
      expect(salesOrderRefusal(problem(503, id))).toEqual({
        action: 'retry',
        message: 'salesOrderTermsUnavailable',
      });
    }
  });

  it('location, line and cart refusals', () => {
    expect(salesOrderRefusal(problem(409, 'SALES_ORDER_LOCATION_UNKNOWN'))).toEqual({
      action: 'reload-locations',
      message: 'salesOrderLocationUnknown',
    });
    expect(
      salesOrderRefusal(problem(400, 'SALES_ORDER_LINE_INVALID', { variantId: 'v9' }))
    ).toEqual({ action: 'show', message: 'salesOrderLineInvalid', variantId: 'v9' });
    expect(salesOrderRefusal(problem(409, 'ORDER_PRODUCT_UNAVAILABLE'))).toEqual({
      action: 'show',
      message: 'salesOrderProductUnavailable',
    });
    expect(salesOrderRefusal(problem(400, 'SALES_ORDER_CART_EMPTY'))).toEqual({
      action: 'show',
      message: 'emptyCart',
    });
    expect(salesOrderRefusal(problem(400, 'SALES_ORDER_TOO_MANY_LINES'))).toEqual({
      action: 'show',
      message: 'salesOrderTooManyLines',
    });
    expect(salesOrderRefusal(problem(404, 'CART_NOT_FOUND'))).toEqual({
      action: 'show',
      message: 'emptyCart',
    });
  });

  it('company choice, and a key used for another body', () => {
    for (const [status, id] of [
      [409, 'SHOP_CUSTOMER_REQUIRED'],
      [403, 'SHOP_CUSTOMER_NOT_MEMBER'],
    ] as const) {
      expect(salesOrderRefusal(problem(status, id))).toEqual({
        action: 'choose-company',
        message: 'companyRequired',
      });
    }
    expect(salesOrderRefusal(problem(409, 'ORDER_IDEMPOTENCY_CONFLICT'))).toEqual({
      action: 'show',
      message: 'salesOrderChanged',
    });
    expect(salesOrderRefusal(problem(422))).toEqual({
      action: 'show',
      message: 'salesOrderFailed',
    });
  });

  it('reads the order id only as a string', () => {
    expect(salesOrderIdOf(problem(409, 'X', { salesOrderId: 7 }))).toBeUndefined();
    expect(salesOrderIdOf(problem(409, 'X', { salesOrderId: 'so' }))).toBe('so');
  });
});

describe('the idempotency key of a checkout attempt', () => {
  const form = {
    locationId: LOCATION,
    purchaseOrderNumber: 'PO-1',
    customerOrderDate: '',
    note: '',
  };
  const base = { cartId: CART, cartVersion: 3, form };
  let n = 0;
  const mint = () => `key-${++n}`;

  it('is minted for the first attempt and kept across a retry of the same cart and form', () => {
    const first = attemptFor(null, attemptFingerprint(base), mint);
    const retry = attemptFor(first, attemptFingerprint({ ...base }), mint);
    expect(retry).toEqual(first);
  });

  it('is rotated when the cart id, the cart version or the form changes', () => {
    const first = attemptFor(null, attemptFingerprint(base), mint);
    for (const changed of [
      { ...base, cartId: '11111111-2222-4333-8444-555555555555' },
      { ...base, cartVersion: 4 },
      { ...base, form: { ...form, purchaseOrderNumber: 'PO-2' } },
      { ...base, form: { ...form, locationId: '' } },
      { ...base, form: { ...form, note: 'Ring' } },
      { ...base, form: { ...form, customerOrderDate: '2026-10-11' } },
    ]) {
      const next = attemptFor(first, attemptFingerprint(changed), mint);
      expect(next.key).not.toBe(first.key);
    }
  });

  it('is kept after an answer that may follow a placed order, spent after any other', () => {
    const attempt: CheckoutAttempt = { key: 'k', fingerprint: 'f' };
    for (const error of [
      new Error('timeout'),
      problem(502, 'SALES_ORDER_UPSTREAM_REFUSED'),
      problem(503, 'SALES_ORDER_CART_UNAVAILABLE'),
      problem(504),
      problem(500),
      problem(429),
    ]) {
      expect(attemptAfter(attempt, error)).toBe(attempt);
    }
    for (const error of [
      problem(409, 'SALES_ORDER_CREDIT_LIMIT_EXCEEDED'),
      problem(409, 'CUSTOMER_BLOCKED'),
      problem(409, 'ORDER_IDEMPOTENCY_CONFLICT'),
      problem(401, 'SHOP_TOKEN_INVALID'),
      problem(422),
    ]) {
      expect(attemptAfter(attempt, error)).toBeNull();
    }
    expect(attemptAfter(attempt, null)).toBeNull();
  });

  it('is read back from session storage only when well formed', () => {
    expect(CHECKOUT_ATTEMPT_KEY).toMatch(/^storefront-starter\./);
    expect(readAttempt(JSON.stringify({ key: 'k', fingerprint: 'f' }))).toEqual({
      key: 'k',
      fingerprint: 'f',
    });
    expect(readAttempt(null)).toBeNull();
    expect(readAttempt('nope')).toBeNull();
    expect(readAttempt(JSON.stringify({ key: '', fingerprint: 'f' }))).toBeNull();
    expect(readAttempt(JSON.stringify({ key: 5, fingerprint: 'f' }))).toBeNull();
  });
});

describe('reorderLines', () => {
  const line = (over: Record<string, unknown>) => ({
    lineId: 'l',
    sku: 's',
    title: 't',
    quantity: 1,
    quantityDelivered: 0,
    backorder: 0,
    inStockNow: 0,
    unitPrice: 1,
    finalPrice: 1,
    productId: 'p1',
    variantId: 'v1',
    ...over,
  });

  it('orders the ordered quantity again, delivered or not', () => {
    const { lines, skipped } = reorderLines({
      lines: [
        line({ quantity: 5, quantityDelivered: 5, backorder: 0 }),
        line({ productId: 'p2', variantId: 'v2', quantity: 3, quantityDelivered: 1, backorder: 2 }),
        line({ productId: 'p3', variantId: 'v3', quantity: 4, quantityDelivered: 0, backorder: 4 }),
      ],
    } as never);
    expect(lines).toEqual([
      { productId: 'p1', variantId: 'v1', quantity: 5 },
      { productId: 'p2', variantId: 'v2', quantity: 3 },
      { productId: 'p3', variantId: 'v3', quantity: 4 },
    ]);
    expect(skipped).toBe(0);
  });

  it('adds up a variant that appears twice, and skips lines without a product or variant', () => {
    const { lines, skipped } = reorderLines({
      lines: [
        line({ quantity: 2 }),
        line({ quantity: 3 }),
        line({ productId: undefined }),
        line({ variantId: undefined }),
        line({ variantId: 'v0', quantity: 0 }),
      ],
    } as never);
    expect(lines).toEqual([{ productId: 'p1', variantId: 'v1', quantity: 5 }]);
    expect(skipped).toBe(3);
  });
});

describe('placedByLabel', () => {
  it('shows the name, and a dash when the name is only an email', () => {
    expect(placedByLabel('Anna Jónsdóttir')).toBe('Anna Jónsdóttir');
    expect(placedByLabel('anna@example.is')).toBe('—');
    expect(placedByLabel('')).toBe('—');
    expect(placedByLabel(undefined)).toBe('—');
  });
});

describe('messages', () => {
  const en = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../i18n/locales/en-US.json'), 'utf8')
  ) as Record<string, string>;

  it('every refusal and status has a message', () => {
    const ids = [
      'CUSTOMER_BLOCKED',
      'SALES_ORDER_CREDIT_LIMIT_EXCEEDED',
      'ORDER_CUSTOMER_PRICES_OFF',
      'ORDER_CUSTOMER_UNAVAILABLE',
      'SALES_ORDER_CART_NOT_BOUND',
      'SALES_ORDER_CART_ALREADY_ORDERED',
      'SALES_ORDER_LOCATION_UNKNOWN',
      'SALES_ORDER_LINE_INVALID',
      'ORDER_PRODUCT_UNAVAILABLE',
      'SALES_ORDER_CART_EMPTY',
      'SALES_ORDER_TOO_MANY_LINES',
      'SALES_ORDER_TERMS_UNAVAILABLE',
      'SALES_ORDER_CREDIT_CHECK_UNAVAILABLE',
      'ORDER_PRICES_UNAVAILABLE',
      'SHOP_CUSTOMER_REQUIRED',
      'ORDER_IDEMPOTENCY_CONFLICT',
      'FEATURE_DISABLED',
      'SHOP_NO_MEMBERSHIP',
      'SALES_ORDER_NOT_FOUND',
      'ORIGIN_NOT_REGISTERED',
      'SALES_ORDER_CART_UNAVAILABLE',
      'SHOP_LOGIN_UNAVAILABLE',
      'SALES_ORDER_CREDIT_CURRENCY_MISMATCH',
    ];
    for (const id of ids) {
      const refusal = salesOrderRefusal(problem(409, id));
      if ('message' in refusal) expect(en[refusal.message], id).toBeTruthy();
    }
    for (const status of [401, 422, 502]) {
      const refusal = salesOrderRefusal(problem(status));
      if ('message' in refusal) expect(en[refusal.message]).toBeTruthy();
    }
    for (const status of SALES_ORDER_STATUSES) expect(en[salesStatusKey(status)]).toBeTruthy();
    expect(en.salesOrderLineInvalidNamed).toContain('{item}');
    expect(en.salesOrderProductUnavailableNamed).toContain('{items}');
    expect(en.salesOrderCompanyChooseAnother).toBeTruthy();
  });
});

describe('the preview always matches the chosen location', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('an older answer that arrives last is ignored, and loading lasts until both settle', async () => {
    const seq = createPreviewSequence();
    const a = deferred<string>();
    const b = deferred<string>();
    const first = latestAnswer(seq, () => a.promise);
    const second = latestAnswer(seq, () => b.promise);
    expect(seq.loading).toBe(true);

    b.resolve('location B');
    await expect(second).resolves.toEqual({ latest: true, value: 'location B' });
    expect(seq.loading).toBe(true); // A is still out: Place order stays disabled

    a.resolve('location A');
    await expect(first).resolves.toEqual({ latest: false, value: 'location A' });
    expect(seq.loading).toBe(false);
  });

  it('an older refusal that arrives last is ignored too', async () => {
    const seq = createPreviewSequence();
    const a = deferred<string>();
    const first = latestAnswer(seq, () => a.promise);
    const second = latestAnswer(seq, async () => 'B');
    await expect(second).resolves.toEqual({ latest: true, value: 'B' });
    a.reject(new Error('A refused'));
    const settled = await first;
    expect(settled.latest).toBe(false);
    expect(settled.error).toBeInstanceOf(Error);
  });

  it('the latest refusal is reported as the latest', async () => {
    const seq = createPreviewSequence();
    const error = new Error('refused');
    await expect(
      latestAnswer(seq, async () => {
        throw error;
      })
    ).resolves.toEqual({ latest: true, error });
    expect(seq.loading).toBe(false);
  });
});

describe('the order pages say why an order cannot be read', () => {
  const routeError = (statusCode: number, errorId?: string) =>
    Object.assign(new Error('FetchError'), {
      statusCode,
      data: { statusCode, data: errorId ? { errorId } : {} },
    });

  it('asks to choose a company only when that is the reason', () => {
    expect(readRefusal(routeError(409, 'SHOP_CUSTOMER_REQUIRED'))).toEqual({
      message: 'companyRequired',
      linkToAccount: true,
    });
    expect(readRefusal(routeError(403, 'SHOP_CUSTOMER_NOT_MEMBER'))).toEqual({
      message: 'companyRequired',
      linkToAccount: true,
    });
  });

  it('a 403 about business login or membership says so, not "choose a company"', () => {
    expect(readRefusal(routeError(403, 'FEATURE_DISABLED'))).toEqual({
      message: 'salesOrderUnavailable',
      linkToAccount: false,
    });
    expect(readRefusal(routeError(403, 'SHOP_NO_MEMBERSHIP'))).toEqual({
      message: 'noMembership',
      linkToAccount: true,
    });
    expect(readRefusal(routeError(403))).toEqual({ message: 'ordersError', linkToAccount: false });
  });
});

describe('paymentTermText', () => {
  const t = (key: string, params: Record<string, number>) => `${key}:${params.count}`;

  it("shows the accounting system's own label when there is one", () => {
    expect(
      paymentTermText({ paymentTermLabel: ' 20 daga ', paymentTermDays: 30 }, t, 'is-IS')
    ).toBe('20 daga');
  });

  it('falls back to the days, with the Icelandic singular for 1, 21 and 31 but not 11', () => {
    expect(paymentTermText({ paymentTermLabel: '', paymentTermDays: 30 }, t, 'is-IS')).toBe(
      'paymentTermDaysOther:30'
    );
    expect(paymentTermText({ paymentTermDays: 21 }, t, 'is-IS')).toBe('paymentTermDaysOne:21');
    expect(paymentTermText({ paymentTermDays: 11 }, t, 'is-IS')).toBe('paymentTermDaysOther:11');
    expect(paymentTermText({ paymentTermDays: 21 }, t, 'en-US')).toBe('paymentTermDaysOther:21');
    expect(paymentTermText({ paymentTermDays: 1 }, t, 'en-US')).toBe('paymentTermDaysOne:1');
  });

  it('is null when the order has neither', () => {
    expect(
      paymentTermText({ paymentTermLabel: null, paymentTermDays: null }, t, 'is-IS')
    ).toBeNull();
    expect(paymentTermText({}, t, 'en-US')).toBeNull();
  });
});
