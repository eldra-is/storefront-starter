import type { EldraCMSSEO } from '~~/.eldra/web-studio';

/** Any entry data with a title, an optional `seo` field and an optional `private` flag. */
export interface SeoSource {
  title?: string | null;
  seo?: EldraCMSSEO | null;
  private?: boolean | null;
}

/** Per-type fallbacks: a product passes its image, a page may pass a description. */
export interface SeoFallback {
  description?: string;
  image?: string | null;
}

export interface SeoMeta {
  title: string | undefined;
  description: string | undefined;
  ogTitle: string | undefined;
  ogDescription: string | undefined;
  robots: string | undefined;
  ogImage?: string;
  twitterCard?: 'summary_large_image';
}

export function buildSeoMeta(
  entry: SeoSource | null | undefined,
  fallback: SeoFallback = {}
): SeoMeta {
  const seo = entry?.seo ?? undefined;
  const title = seo?.title || entry?.title || undefined;
  const description = seo?.description || fallback.description || undefined;
  return {
    title,
    description,
    ogTitle: seo?.ogTitle || title,
    ogDescription: seo?.ogDescription || description,
    // Only an explicit true opts out; entries without the flag stay public.
    robots: entry?.private === true ? 'noindex, nofollow' : undefined,
    ...(fallback.image
      ? { ogImage: fallback.image, twitterCard: 'summary_large_image' as const }
      : {}),
  };
}
