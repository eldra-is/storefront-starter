import type { EldraProductDetails, EldraProductList } from '@eldrajs/sdk';
import type { Category, Collection, ProductDetail, ProductListItem } from '~/types/catalog';
import { MAX_PAGE_SIZE, catalogKey } from '~~/shared/utils/customer-prices';

/**
 * Catalog reads through the SDK, normalised once so pages never see a null list. An organization
 * without the commerce feature gets empty lists and 404s instead of failing requests.
 *
 * Products are priced: a signed-in business customer's product reads go through the server routes
 * in server/api/catalog, which add their token and company, on the server render and on client-side
 * navigation alike, so they never see list prices as theirs. A guest's go straight to the gateway.
 * Categories and collections carry no prices and always go straight to the gateway.
 */
export function useCatalog() {
  const eldra = useEldraClient();
  const { locale } = useLocale();
  const organization = useOrganization();
  const pricing = useCustomerPricing();
  // Forwards the session cookie on the server render; the browser sends it itself.
  const serverFetch = useRequestFetch();
  const enabled = () => organization.value.commerce;
  const priced = () => pricing.value.signedIn;

  /** The first `pageSize` products (at most 100: lists are not paginated yet). */
  async function listProducts(
    categoryId?: string,
    pageSize = MAX_PAGE_SIZE
  ): Promise<ProductListItem[]> {
    if (!enabled()) return [];
    const query = { locale: locale.value, categoryId, pageSize: Math.min(pageSize, MAX_PAGE_SIZE) };
    const res = priced()
      ? await serverFetch<EldraProductList>('/api/catalog/products', { query })
      : await eldra.catalog.listProducts(query);
    return res?.data ?? [];
  }

  async function getProduct(slug: string): Promise<ProductDetail> {
    if (!enabled()) throw createError({ statusCode: 404, statusMessage: 'Product not found' });
    const res = priced()
      ? await serverFetch<EldraProductDetails>(
          `/api/catalog/products/${encodeURIComponent(slug)}`,
          { query: { locale: locale.value } }
        )
      : await eldra.catalog.getProduct(slug, { locale: locale.value });
    return {
      ...res,
      variants: res.variants ?? [],
      options: (res.options ?? []).map((option) => ({ ...option, values: option.values ?? [] })),
    };
  }

  async function listCategories(): Promise<Category[]> {
    if (!enabled()) return [];
    return eldra.catalog.listCategories({ locale: locale.value });
  }

  async function listCollections(): Promise<Collection[]> {
    if (!enabled()) return [];
    const res = await eldra.catalog.listCollections({ locale: locale.value });
    return res?.data ?? [];
  }

  async function getCollection(slug: string): Promise<Collection | null> {
    if (!enabled()) return null;
    return eldra.catalog.getCollection(slug, { locale: locale.value });
  }

  async function listCollectionProducts(slug: string): Promise<ProductListItem[]> {
    if (!enabled()) return [];
    const query = { locale: locale.value, pageSize: MAX_PAGE_SIZE };
    const res = priced()
      ? await serverFetch<EldraProductList>(
          `/api/catalog/collections/${encodeURIComponent(slug)}/products`,
          { query }
        )
      : await eldra.catalog.listCollectionProducts(slug, query);
    return res?.data ?? [];
  }

  /** The `useAsyncData` key for a priced read: per company when signed in, unchanged for a guest. */
  const key = (base: string) => catalogKey(base, pricing.value);

  return {
    key,
    listProducts,
    getProduct,
    listCategories,
    listCollections,
    getCollection,
    listCollectionProducts,
  };
}
