import { addItemInput } from '~~/shared/utils/customer-prices';

/**
 * Adds a line as the signed-in business customer: an unbound cart is bound to their company and
 * repriced. Without a session it is a guest add. Never cached.
 */
export default defineEventHandler(async (event) => {
  const input = addItemInput(await readBody(event).catch(() => null));
  if (!input) throw createError({ statusCode: 400, statusMessage: 'Bad request' });
  return pricedCall(event, 'write', (eldra, context) => eldra.cart.addItem(input, context));
});
