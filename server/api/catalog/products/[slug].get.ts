import { queryString } from '~~/shared/utils/customer-prices';

/** One product, priced for the signed-in business customer's company (list prices for a guest). Never cached. */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') ?? '';
  const locale = queryString(getQuery(event).locale);
  return pricedCall(event, 'read', (eldra, context) =>
    eldra.catalog.getProduct(slug, { locale }, context)
  );
});
