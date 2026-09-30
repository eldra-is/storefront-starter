import { loadOrganizationSettings } from '~~/app/utils/organization';
import { createConfiguredEldraClient } from '~~/shared/utils/eldra-client';
import { buildSitemapXml } from '~~/shared/utils/sitemap';

const MAX_PAGES = 50;

// Published content only: this client never carries the preview token. Page slugs are not localised.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const eldra = createConfiguredEldraClient({
    apiBaseUrl: config.public.eldraApiBaseUrl,
    orgId: config.public.eldraOrgId,
    checkoutUrl: config.public.checkoutUrl,
  });
  const { defaultLocale } = await loadOrganizationSettings(eldra, String(config.public.eldraOrgId));
  const paths: string[] = ['/'];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await eldra.cms
      .list('page', { page, pageSize: 100, depth: 0, locale: defaultLocale })
      .catch(() => null);
    for (const entry of res?.data ?? []) {
      if (entry.data.slug && entry.data.private !== true) paths.push(`/pages/${entry.data.slug}`);
    }
    if (!res?.meta?.hasNext) break;
  }

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await eldra.catalog
      .listProducts({ page, pageSize: 100, locale: defaultLocale })
      .catch(() => null);
    if (!res) break;
    if (page === 1) paths.push('/shop', '/collections');
    for (const product of res.data ?? []) paths.push(`/products/${product.slug}`);
    if (!res.meta?.hasNext) break;
  }

  setHeader(event, 'content-type', 'application/xml; charset=utf-8');
  return buildSitemapXml(String(config.public.siteUrl), paths);
});
