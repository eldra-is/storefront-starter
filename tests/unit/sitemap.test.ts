import { describe, expect, it } from 'vitest';
import { buildSitemapXml } from '../../shared/utils/sitemap';

describe('buildSitemapXml', () => {
  it('lists each path once, sorted, under the site origin, escaped', () => {
    const xml = buildSitemapXml('https://shop.example.com/', [
      '/pages/b',
      '/',
      '/pages/b',
      '/pages/a&b',
    ]);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url><loc>https://shop.example.com/</loc></url>',
        '  <url><loc>https://shop.example.com/pages/a&amp;b</loc></url>',
        '  <url><loc>https://shop.example.com/pages/b</loc></url>',
        '</urlset>',
        '',
      ].join('\n')
    );
  });
});
