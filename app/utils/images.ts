/** The resized variants the asset service serves at `{url}/{name}`. */
export const IMAGE_VARIANTS = [
  { name: 'sm', width: 400 },
  { name: 'md', width: 800 },
  { name: 'lg', width: 1200 },
  { name: 'xl', width: 1920 },
] as const;

const base = (url: string) => url.replace(/\/+$/, '');

/** The smallest variant at least as wide as the display width (800px when unknown). */
export function mediaSrc(url: string, width?: number): string {
  const target = width && width > 0 ? width : 800;
  // Wider than every variant: the largest one (the tuple's last element, always defined).
  const variant = IMAGE_VARIANTS.find((v) => v.width >= target) ?? IMAGE_VARIANTS[3];
  return `${base(url)}/${variant.name}`;
}

export function mediaSrcset(url: string): string {
  return IMAGE_VARIANTS.map((v) => `${base(url)}/${v.name} ${v.width}w`).join(', ');
}
