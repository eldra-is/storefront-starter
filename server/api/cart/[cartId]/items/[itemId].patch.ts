import { quantityOf } from '~~/shared/utils/customer-prices';

/** Changes a line's quantity as the signed-in business customer (a guest change without a session). */
export default defineEventHandler(async (event) => {
  const cartId = getRouterParam(event, 'cartId') ?? '';
  const itemId = getRouterParam(event, 'itemId') ?? '';
  const quantity = quantityOf(await readBody(event).catch(() => null));
  if (quantity === null) throw createError({ statusCode: 400, statusMessage: 'Bad request' });
  return pricedCall(event, 'write', (eldra, context) =>
    eldra.cart.updateItem(cartId, itemId, { quantity }, context)
  );
});
