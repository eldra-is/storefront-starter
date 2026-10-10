import { PRICED_RESPONSE_HEADERS } from '~~/shared/utils/customer-prices';
import { previewInput } from '~~/shared/utils/sales-orders';

/**
 * What the active company would be charged for its bound cart, delivered to a location: lines,
 * totals, payment term and `credit: { status, wouldBlock }` (never a figure). Writes nothing.
 * Same-origin only; never cached.
 */
export default defineEventHandler(async (event) => {
  // Before anything can fail: a refusal is no more cacheable than an order.
  setResponseHeaders(event, { ...PRICED_RESPONSE_HEADERS });
  const input = previewInput(await readBody(event).catch(() => null));
  if (!input) throw createError({ statusCode: 400, statusMessage: 'Bad request' });
  return businessCall(event, 'write', (eldra, context) =>
    eldra.salesOrders.preview(input, context)
  );
});
