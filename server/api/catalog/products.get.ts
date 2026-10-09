import { pageSizeOf, queryString } from '~~/shared/utils/customer-prices';

/** Products, priced for the signed-in business customer's company (list prices for a guest). Never cached. */
export default defineEventHandler((event) => {
  const query = getQuery(event);
  return pricedCall(event, 'read', (eldra, context) =>
    eldra.catalog.listProducts(
      {
        locale: queryString(query.locale),
        categoryId: queryString(query.categoryId),
        pageSize: pageSizeOf(query.pageSize),
      },
      context
    )
  );
});
