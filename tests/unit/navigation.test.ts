import { describe, expect, it } from 'vitest';
import {
  headerNavigation,
  isCommercePath,
  isExternalHref,
  type HeaderNavigationItem,
} from '../../app/utils/navigation';

const item = (
  id: string,
  href: string,
  kind: HeaderNavigationItem['kind'] = 'link'
): HeaderNavigationItem => ({
  id,
  label: id,
  href,
  kind,
  openInNewTab: false,
});

describe('headerNavigation', () => {
  const configured = [
    item('shop', '/shop', 'catalog-menu'),
    item('collections', '/collections'),
    item('about', '/pages/about'),
  ];

  it('uses the CMS items when there are any', () => {
    expect(
      headerNavigation(configured, [item('fallback', '/shop')], true).map((i) => i.id)
    ).toEqual(['shop', 'collections', 'about']);
  });

  it('falls back when the CMS has no header', () => {
    expect(
      headerNavigation([], [item('fallback', '/shop', 'catalog-menu')], true).map((i) => i.id)
    ).toEqual(['fallback']);
  });

  it('drops catalog menus and shop links for an organization without commerce', () => {
    expect(headerNavigation(configured, [], false).map((i) => i.id)).toEqual(['about']);
  });
});

describe('isCommercePath', () => {
  it('matches shop routes and ignores the query', () => {
    expect(isCommercePath('/shop?category=hats')).toBe(true);
    expect(isCommercePath('/products/a-hat')).toBe(true);
    expect(isCommercePath('/pages/shop-policy')).toBe(false);
    expect(isCommercePath('https://example.com/shop')).toBe(false);
  });
});

describe('isExternalHref', () => {
  it('recognizes absolute http(s) URLs', () => {
    expect(isExternalHref('https://example.com/shop')).toBe(true);
    expect(isExternalHref('http://example.com')).toBe(true);
  });

  it('recognizes protocol-relative URLs', () => {
    expect(isExternalHref('//example.com/shop')).toBe(true);
  });

  it('recognizes mailto and tel links', () => {
    expect(isExternalHref('mailto:hello@example.com')).toBe(true);
    expect(isExternalHref('tel:+15551234567')).toBe(true);
  });

  it('treats internal paths as not external', () => {
    expect(isExternalHref('/shop')).toBe(false);
    expect(isExternalHref('/pages/about?x=1')).toBe(false);
    expect(isExternalHref('#anchor')).toBe(false);
  });
});
