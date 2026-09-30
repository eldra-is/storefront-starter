/**
 * Script origins a CMS embed block may load, reviewed in code. Empty by default: iframes and
 * embeds from any HTTPS origin work; scripts load from nowhere until an origin is added here.
 */
export const EMBED_SCRIPT_ORIGINS: readonly string[] = [];

export function safeEmbedUrl(
  tag: string | undefined,
  raw: string | undefined,
  scriptOrigins: readonly string[] = EMBED_SCRIPT_ORIGINS
): string | undefined {
  if (tag !== 'iframe' && tag !== 'embed' && tag !== 'script') return undefined;
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  if (tag === 'script' && !scriptOrigins.includes(url.origin)) return undefined;
  return url.href;
}
