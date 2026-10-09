import { pageSizeOf, queryString } from '~~/shared/utils/customer-prices';

/** A collection's products, priced for the signed-in business customer's company. Never cached. */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') ?? '';
  const query = getQuery(event);
  return pricedCall(event, 'read', (eldra, context) =>
    eldra.catalog.listCollectionProducts(
      slug,
      { locale: queryString(query.locale), pageSize: pageSizeOf(query.pageSize) },
      context
    )
  );
});
