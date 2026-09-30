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
 * True for a link that leaves the router: an absolute http(s) URL, a protocol-relative `//` URL, or a
 * `mailto:`/`tel:` link. NuxtLink gets `external` for these so it never resolves them as routes.
 */
export function isExternalHref(href: string): boolean {
  return opensInNewTab(href) || /^(mailto|tel):/i.test(href);
}

/** True for a link to another website (http(s) or protocol-relative); mail and phone links stay in the tab. */
export function opensInNewTab(href: string): boolean {
  return /^(https?:)?\/\//i.test(href);
}

/** Schemes a CMS link may use; anything else (javascript:, data:, vbscript:, …) is dropped. */
const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

/**
 * The trimmed href when it is safe to render from CMS content: an http(s), mailto: or tel: URL, a
 * protocol-relative URL, a relative path, a query or an #anchor. Anything with another scheme — a
 * `javascript:` link would run on click — or an empty value yields undefined.
 */
export function safeHref(href: string | null | undefined): string | undefined {
  const trimmed = href?.trim() ?? '';
  if (!trimmed) return undefined;
  // Browsers ignore tabs, newlines and other control characters inside a scheme ("java\tscript:").
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  const normalized = trimmed.replace(/[\u0000-\u001f\u007f\s]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  if (scheme === undefined) return trimmed;
  return SAFE_SCHEMES.includes(scheme) ? trimmed : undefined;
}
