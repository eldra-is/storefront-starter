import { EldraHttpError } from '@eldrajs/sdk';

/**
 * The gateway's reason as passed on by one of this site's priced routes (server/api/catalog,
 * server/api/cart): the route answers `{ statusCode, data: { errorId, code } }`, which `$fetch`
 * throws as an error whose `data` is that body.
 */
function routeProblem(err: unknown): { errorId?: string; code?: string } | undefined {
  if (!err || typeof err !== 'object' || err instanceof EldraHttpError) return undefined;
  const data = (err as { data?: { data?: unknown } }).data?.data;
  if (!data || typeof data !== 'object') return undefined;
  const { errorId, code } = data as { errorId?: unknown; code?: unknown };
  return {
    ...(typeof errorId === 'string' ? { errorId } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

/** The gateway's specific reason, or its category when it has nothing more specific. Never the message. */
export function errorIdOf(err: unknown): string | undefined {
  if (err instanceof EldraHttpError) return err.errorId ?? err.code;
  const problem = routeProblem(err);
  return problem?.errorId ?? problem?.code;
}

/** A missing CMS entry, product or page slug. */
export function isNotFound(err: unknown): boolean {
  if (err instanceof EldraHttpError) return err.code === 'NOT_FOUND';
  return routeProblem(err)?.code === 'NOT_FOUND';
}

/**
 * The server forgot the cart: drop the stored id and start a new one. Only the specific reason
 * counts — a bare NOT_FOUND on an add can equally mean a missing product or variant, and treating
 * it as a lost cart would throw away a live one.
 */
export function isCartNotFound(err: unknown): boolean {
  return errorIdOf(err) === 'CART_NOT_FOUND';
}

/**
 * Whether a failed cart mutation means the cart itself is gone. CART_NOT_FOUND says so outright. A
 * bare NOT_FOUND is ambiguous (a missing product, variant or line answers the same way), so it is
 * confirmed by reading the cart: only when that read is also not found is the cart gone.
 */
export async function isCartGone(err: unknown, readCart: () => Promise<unknown>): Promise<boolean> {
  if (isCartNotFound(err)) return true;
  if (!isNotFound(err)) return false;
  try {
    await readCart();
    return false;
  } catch (readErr) {
    return isNotFound(readErr);
  }
}

/** An add or quantity change the stock cannot cover. */
export function isOutOfStock(err: unknown): boolean {
  const id = errorIdOf(err);
  return id === 'CART_INSUFFICIENT_STOCK' || id === 'CONFLICT';
}
