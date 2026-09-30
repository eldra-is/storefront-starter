import { EldraHttpError } from '@eldrajs/sdk';
import { describe, expect, it } from 'vitest';
import { errorIdOf, isCartNotFound, isNotFound, isOutOfStock } from '../../app/utils/errors';

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
    expect(isCartNotFound(problem(404, 'NOT_FOUND'))).toBe(true);
    expect(isOutOfStock(problem(409, 'CONFLICT', 'CART_INSUFFICIENT_STOCK'))).toBe(true);
    expect(isOutOfStock(problem(409, 'CONFLICT'))).toBe(true);
    expect(isOutOfStock(problem(404, 'NOT_FOUND', 'CART_NOT_FOUND'))).toBe(false);
  });
});
