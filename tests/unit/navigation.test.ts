import { describe, expect, it } from 'vitest';
import {
  headerNavigation,
  isCommercePath,
  isExternalHref,
  opensInNewTab,
  safeHref,
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

describe('opensInNewTab', () => {
  it('opens other websites in a new tab, never mail, phone or internal links', () => {
    expect(opensInNewTab('https://example.com')).toBe(true);
    expect(opensInNewTab('//example.com')).toBe(true);
    expect(opensInNewTab('mailto:hello@example.com')).toBe(false);
    expect(opensInNewTab('tel:+15551234567')).toBe(false);
    expect(opensInNewTab('/shop')).toBe(false);
  });
});

describe('safeHref', () => {
  it('keeps web, mail and phone links, trimmed', () => {
    expect(safeHref(' https://example.com/a ')).toBe('https://example.com/a');
    expect(safeHref('HTTP://example.com')).toBe('HTTP://example.com');
    expect(safeHref('//example.com')).toBe('//example.com');
    expect(safeHref('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(safeHref('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('keeps relative paths, queries and anchors', () => {
    expect(safeHref('/pages/about')).toBe('/pages/about');
    expect(safeHref('pages/about')).toBe('pages/about');
    expect(safeHref('?category=hats')).toBe('?category=hats');
    expect(safeHref('#details')).toBe('#details');
    expect(safeHref('/search?q=a:b')).toBe('/search?q=a:b');
  });

  it('drops script and data URLs, however they are disguised', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('  JavaScript:alert(1)')).toBeUndefined();
    expect(safeHref('java\tscript:alert(1)')).toBeUndefined();
    expect(safeHref('java\nscript:alert(1)')).toBeUndefined();
    expect(safeHref('\u0001javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
  });

  it('yields undefined for an empty value', () => {
    expect(safeHref('')).toBeUndefined();
    expect(safeHref('   ')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});
