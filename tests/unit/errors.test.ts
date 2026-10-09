import { EldraHttpError } from '@eldrajs/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  errorIdOf,
  isCartGone,
  isCartNotFound,
  isNotFound,
  isOutOfStock,
} from '../../app/utils/errors';

const problem = (status: number, code: string, errorId?: string) =>
  new EldraHttpError(new Response(null, { status }), { code, ...(errorId ? { errorId } : {}) });

describe('SDK error helpers', () => {
  it('reads errorId, falling back to the code category', () => {
    expect(errorIdOf(problem(404, 'NOT_FOUND', 'CART_NOT_FOUND'))).toBe('CART_NOT_FOUND');
    expect(errorIdOf(problem(404, 'NOT_FOUND'))).toBe('NOT_FOUND');
    expect(errorIdOf(new Error('Cart not found'))).toBeUndefined();
  });

  it('recognizes a missing CMS entry or page slug by its category', () => {
    expect(isNotFound(problem(404, 'NOT_FOUND', 'ENTRY_NOT_FOUND'))).toBe(true);
    expect(isNotFound(problem(500, 'INTERNAL'))).toBe(false);
    expect(isNotFound(new Error('not found'))).toBe(false);
  });

  it('recognizes a forgotten cart and an out-of-stock add', () => {
    expect(isCartNotFound(problem(404, 'NOT_FOUND', 'CART_NOT_FOUND'))).toBe(true);
    expect(isOutOfStock(problem(409, 'CONFLICT', 'CART_INSUFFICIENT_STOCK'))).toBe(true);
    expect(isOutOfStock(problem(409, 'CONFLICT'))).toBe(true);
    expect(isOutOfStock(problem(404, 'NOT_FOUND', 'CART_NOT_FOUND'))).toBe(false);
  });

  it('does not mistake a missing product or variant for a forgotten cart', () => {
    expect(isCartNotFound(problem(404, 'NOT_FOUND'))).toBe(false);
    expect(isCartNotFound(problem(404, 'NOT_FOUND', 'VARIANT_NOT_FOUND'))).toBe(false);
    expect(isCartNotFound(problem(404, 'NOT_FOUND', 'PRODUCT_NOT_FOUND'))).toBe(false);
    expect(isCartNotFound(new Error('Cart not found'))).toBe(false);
  });
});

describe('isCartGone', () => {
  const cartMissing = () => Promise.reject(problem(404, 'NOT_FOUND', 'CART_NOT_FOUND'));
  const cartThere = () => Promise.resolve({ id: 'cart-1' });

  it('trusts CART_NOT_FOUND without reading the cart', async () => {
    const readCart = vi.fn(cartThere);
    expect(await isCartGone(problem(404, 'NOT_FOUND', 'CART_NOT_FOUND'), readCart)).toBe(true);
    expect(readCart).not.toHaveBeenCalled();
  });

  it('keeps a live cart when a bare NOT_FOUND was about a product or variant', async () => {
    const readCart = vi.fn(cartThere);
    expect(await isCartGone(problem(404, 'NOT_FOUND'), readCart)).toBe(false);
    expect(readCart).toHaveBeenCalledOnce();
  });

  it('confirms a bare NOT_FOUND when the cart read is also not found', async () => {
    expect(await isCartGone(problem(404, 'NOT_FOUND'), cartMissing)).toBe(true);
    expect(
      await isCartGone(problem(404, 'NOT_FOUND'), () => Promise.reject(problem(404, 'NOT_FOUND')))
    ).toBe(true);
  });

  it('keeps the cart when the confirming read fails for another reason', async () => {
    expect(
      await isCartGone(problem(404, 'NOT_FOUND'), () => Promise.reject(problem(503, 'UNAVAILABLE')))
    ).toBe(false);
  });

  it('never reads the cart for stock or other failures', async () => {
    const readCart = vi.fn(cartMissing);
    expect(await isCartGone(problem(409, 'CONFLICT', 'CART_INSUFFICIENT_STOCK'), readCart)).toBe(
      false
    );
    expect(await isCartGone(new Error('offline'), readCart)).toBe(false);
    expect(readCart).not.toHaveBeenCalled();
  });
});

describe('priced route errors', () => {
  // What $fetch throws for a server/api/catalog or server/api/cart refusal: data is the h3 body.
  const routeError = (statusCode: number, data: Record<string, string>) =>
    Object.assign(new Error('FetchError'), { data: { statusCode, data } });

  it('reads the gateway reason a route passed on', () => {
    expect(
      errorIdOf(routeError(409, { errorId: 'CART_CUSTOMER_MISMATCH', code: 'CONFLICT' }))
    ).toBe('CART_CUSTOMER_MISMATCH');
    expect(errorIdOf(routeError(409, { code: 'CONFLICT' }))).toBe('CONFLICT');
    expect(isOutOfStock(routeError(409, { errorId: 'CART_INSUFFICIENT_STOCK' }))).toBe(true);
  });

  it('recognizes a missing product behind a route', () => {
    expect(isNotFound(routeError(404, { code: 'NOT_FOUND' }))).toBe(true);
    expect(isNotFound(routeError(502, {}))).toBe(false);
    expect(isCartNotFound(routeError(404, { errorId: 'CART_NOT_FOUND', code: 'NOT_FOUND' }))).toBe(
      true
    );
  });
});
