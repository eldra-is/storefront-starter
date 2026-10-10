import { orderListQuery } from '~~/shared/utils/sales-orders';

/** The active company's orders on account, newest first (`?page&pageSize&status`). Never cached. */
export default defineEventHandler((event) => {
  const options = orderListQuery(getQuery(event));
  return businessCall(event, 'read', (eldra, context) => eldra.salesOrders.list(options, context));
});
