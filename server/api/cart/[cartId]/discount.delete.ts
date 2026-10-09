import { queryString } from '~~/shared/utils/customer-prices';

/** Removes the discount code as the signed-in business customer (a guest removal without a session). */
export default defineEventHandler((event) => {
  const cartId = getRouterParam(event, 'cartId') ?? '';
  const locale = queryString(getQuery(event).locale);
  return pricedCall(event, 'write', (eldra, context) =>
    eldra.cart.removeDiscount(cartId, { locale }, context)
  );
});
