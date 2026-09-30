import { EldraHttpError } from '@eldrajs/sdk';

/** The gateway's specific reason, or its category when it has nothing more specific. Never the message. */
export function errorIdOf(err: unknown): string | undefined {
  return err instanceof EldraHttpError ? (err.errorId ?? err.code) : undefined;
}

/** A missing CMS entry, product or page slug. */
export function isNotFound(err: unknown): boolean {
  return err instanceof EldraHttpError && err.code === 'NOT_FOUND';
}

/** The server forgot the cart: drop the stored id and start a new one. */
export function isCartNotFound(err: unknown): boolean {
  const id = errorIdOf(err);
  return id === 'CART_NOT_FOUND' || id === 'NOT_FOUND';
}

/** An add or quantity change the stock cannot cover. */
export function isOutOfStock(err: unknown): boolean {
  const id = errorIdOf(err);
  return id === 'CART_INSUFFICIENT_STOCK' || id === 'CONFLICT';
}
