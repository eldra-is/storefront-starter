import type { Category, Collection, ProductDetail, ProductListItem } from '~/types/catalog';

/** Lists return their first page only; pagination is not implemented yet (README, Known limits). */
const MAX_PAGE_SIZE = 100;

/**
 * Catalog reads through the SDK, normalised once so pages never see a null list. An organization
 * without the commerce feature gets empty lists and 404s instead of failing requests.
 */
export function useCatalog() {
  const eldra = useEldraClient();
  const { locale } = useLocale();
  const organization = useOrganization();
  const enabled = () => organization.value.commerce;

  /** The first `pageSize` products (at most 100: lists are not paginated yet). */
  async function listProducts(
    categoryId?: string,
    pageSize = MAX_PAGE_SIZE
  ): Promise<ProductListItem[]> {
    if (!enabled()) return [];
    const res = await eldra.catalog.listProducts({
      locale: locale.value,
      categoryId,
      pageSize: Math.min(pageSize, MAX_PAGE_SIZE),
    });
    return res?.data ?? [];
  }

  async function getProduct(slug: string): Promise<ProductDetail> {
    if (!enabled()) throw createError({ statusCode: 404, statusMessage: 'Product not found' });
    const res = await eldra.catalog.getProduct(slug, { locale: locale.value });
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
    const res = await eldra.catalog.listCollectionProducts(slug, {
      locale: locale.value,
      pageSize: MAX_PAGE_SIZE,
    });
    return res?.data ?? [];
  }

  return {
    listProducts,
    getProduct,
    listCategories,
    listCollections,
    getCollection,
    listCollectionProducts,
  };
}
