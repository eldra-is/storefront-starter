import { PRICED_RESPONSE_HEADERS } from '~~/shared/utils/customer-prices';
import { salesOrderParam } from '~~/shared/utils/sales-orders';

/**
 * One of the active company's orders with its lines (ordered, delivered, backorder, in stock now).
 * Another company's order is 404, the same as one that does not exist. Never cached.
 */
export default defineEventHandler((event) => {
  setResponseHeaders(event, { ...PRICED_RESPONSE_HEADERS });
  const id = salesOrderParam(getRouterParam(event, 'id'));
  if (!id) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  return businessCall(event, 'read', (eldra, context) => eldra.salesOrders.get(id, context));
});
