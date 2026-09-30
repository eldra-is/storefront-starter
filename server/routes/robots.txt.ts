export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const siteUrl = String(config.public.siteUrl).replace(/\/+$/, '');
  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  return config.public.siteIndexable
    ? `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
});
