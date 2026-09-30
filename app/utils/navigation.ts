export interface HeaderNavigationItem {
  id: string;
  label: string;
  href: string;
  /** `catalog-menu` items open the live catalog categories below them. */
  kind: 'catalog-menu' | 'link';
  openInNewTab: boolean;
}

const COMMERCE_PATHS = ['/shop', '/collections', '/products', '/cart'];

export function isCommercePath(href: string): boolean {
  const path = href.split(/[?#]/)[0] ?? '';
  return COMMERCE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** The CMS items when there are any, else the fallback; shop links only when the organization sells. */
export function headerNavigation(
  configured: HeaderNavigationItem[],
  fallback: HeaderNavigationItem[],
  commerce: boolean
): HeaderNavigationItem[] {
  const items = configured.length ? configured : fallback;
  return commerce
    ? items
    : items.filter((item) => item.kind !== 'catalog-menu' && !isCommercePath(item.href));
}

/**
 * True for a link that leaves the site: an absolute http(s) URL, a protocol-relative `//` URL, or a
 * `mailto:`/`tel:` link. Used by block Image/Button components to decide `target="_blank"` and `rel`.
 */
export function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href);
}
