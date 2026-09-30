import type {
  EldraCMSSchemaMap,
  FooterLinkData,
  HomeHeroData,
  HomeSectionData,
  PageEntry,
  SiteFooterData,
  SiteHeaderData,
} from '~~/.eldra/web-studio';

/** Page depth: blocks arrive resolved, deeper references resolve lazily in BlocksRenderer. */
const PAGE_DEPTH = 2;

/** CMS content is optional decoration: a missing schema, entry or failure yields nothing, never an error page. */
export function useCms() {
  const eldra = useEldraClient();
  const { locale } = useLocale();

  async function list<SchemaApiId extends keyof EldraCMSSchemaMap>(schemaApiId: SchemaApiId) {
    try {
      const res = await eldra.cms.list(schemaApiId, {
        locale: locale.value,
        page: 1,
        pageSize: 100,
        depth: 1,
      });
      return res?.data ?? [];
    } catch {
      return [];
    }
  }

  async function hero(): Promise<HomeHeroData | null> {
    return (await list('home_hero'))[0]?.data ?? null;
  }

  async function sections(): Promise<HomeSectionData<1>[]> {
    return (await list('home_section'))
      .map((e) => e.data)
      .filter((s) => s.active !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async function footer(): Promise<{ links: FooterLinkData[]; footer: SiteFooterData | null }> {
    const [links, footers] = await Promise.all([list('footer_link'), list('site_footer')]);
    return {
      links: links.map((e) => e.data).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      footer: footers[0]?.data ?? null,
    };
  }

  async function header(): Promise<SiteHeaderData<1> | null> {
    return (await list('site_header'))[0]?.data ?? null;
  }

  async function page(slug: string): Promise<PageEntry<typeof PAGE_DEPTH> | null> {
    try {
      return await eldra.cms.getEntryByUniqueField('page', 'slug', slug, {
        locale: locale.value,
        depth: PAGE_DEPTH,
      });
    } catch (err) {
      // An unknown slug is the ordinary 404 path; anything else is logged and still a 404.
      if (!isNotFound(err)) console.warn(`[cms] page "${slug}" could not be read`, err);
      return null;
    }
  }

  return { header, hero, sections, footer, page };
}
