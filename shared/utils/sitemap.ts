const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function buildSitemapXml(siteUrl: string, paths: Iterable<string>): string {
  const origin = siteUrl.replace(/\/+$/, '');
  const urls = [...new Set(paths)]
    .sort()
    .map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
