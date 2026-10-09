/** Removes a line as the signed-in business customer (a guest removal without a session). */
export default defineEventHandler((event) => {
  const cartId = getRouterParam(event, 'cartId') ?? '';
  const itemId = getRouterParam(event, 'itemId') ?? '';
  return pricedCall(event, 'write', (eldra, context) =>
    eldra.cart.removeItem(cartId, itemId, context)
  );
});
