import { PRICED_RESPONSE_HEADERS } from '~~/shared/utils/customer-prices';
import { createOrderInput, idempotencyKeyOf } from '~~/shared/utils/sales-orders';

/**
 * Places the active company's bound cart as an order on account. The browser's `Idempotency-Key`
 * (one per checkout attempt) is required and forwarded as sent: a retry with the same key after no
 * answer or a 5xx replays an order that was placed. Same-origin only; never cached.
 */
export default defineEventHandler(async (event) => {
  // Before anything can fail: a refusal is no more cacheable than an order.
  setResponseHeaders(event, { ...PRICED_RESPONSE_HEADERS });
  await requireSameOriginWrite(event);
  const idempotencyKey = idempotencyKeyOf(getRequestHeader(event, 'idempotency-key'));
  const input = createOrderInput(await readBody(event).catch(() => null));
  if (!input || !idempotencyKey) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' });
  }
  const order = await businessCall(event, 'write', (eldra, context) =>
    eldra.salesOrders.create(input, { idempotencyKey }, context)
  );
  setResponseStatus(event, 201);
  return order;
});
