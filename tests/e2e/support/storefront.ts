import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

interface ManifestEntry {
  ref: string;
  schemaRef: string;
  data: Record<string, unknown>;
  localizations?: Record<string, Record<string, unknown>>;
}

const manifest = JSON.parse(
  readFileSync(new URL('../../../cms/content-model.eldra.json', import.meta.url), 'utf8')
) as { entries: ManifestEntry[] };

function entry(ref: string): ManifestEntry {
  const found = manifest.entries.find((e) => e.ref === ref);
  if (!found) throw new Error(`The manifest has no ${ref}`);
  return found;
}

/** A string field of a manifest entry, localized or not. */
export function text(ref: string, field: string, locale: 'en-US' | 'is-IS' = 'en-US'): string {
  const e = entry(ref);
  const value = e.localizations?.[locale]?.[field] ?? e.data[field];
  if (typeof value !== 'string') throw new Error(`${ref}.${field} is not a string`);
  return value;
}

/** CMS fixtures come from the manifest: slugs and labels survive a reimport, ids do not. */
export const FIXTURES = {
  heroTitle: text('entry:home_hero:main', 'title'),
  heroLink: text('entry:home_hero:main', 'ctaLink'),
  sectionCount: manifest.entries.filter((e) => e.schemaRef === 'schema:home_section').length,
  aboutLabel: {
    en: text('entry:navigation_item:about', 'label'),
    is: text('entry:navigation_item:about', 'label', 'is-IS'),
  },
  aboutPage: text('entry:page:about', 'slug'),
  aboutTitle: text('entry:page:about', 'title'),
  shippingPage: text('entry:page:shipping-and-returns', 'slug'),
  /** Catalog data is the organization's: set a live code to run the discount test. */
  discountCode: process.env.E2E_DISCOUNT_CODE ?? '',
};

export const CHECKOUT_ORIGIN = (
  process.env.NUXT_PUBLIC_CHECKOUT_URL || 'https://checkout.eldra.app'
).replace(/\/+$/, '');

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Vue attaches listeners after the SSR paint; clicks before that land on dead markup. */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Boolean(
      (document.getElementById('__nuxt') as unknown as { __vue_app__?: unknown })?.__vue_app__
    )
  );
}

export async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForHydration(page);
}

export async function reload(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForHydration(page);
}

/** "12.900 kr." → 12900, "€12.50" → 1250: enough to compare prices in any currency. */
export function priceDigits(value: string): number {
  return Number(value.replace(/[^\d]/g, ''));
}

/** Slugs of the products on the first shop page. */
export async function productSlugs(page: Page): Promise<string[]> {
  await goto(page, '/shop');
  const cards = page.locator('[data-testid^="product-card-"]');
  await expect(
    cards.first(),
    'the organization needs at least one published product'
  ).toBeVisible();
  const ids = await cards.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-testid') ?? '')
  );
  return ids.map((id) => id.replace('product-card-', ''));
}

/** The first product (of the first ten) whose page satisfies `accept`; the page is left on it. */
export async function findProduct(
  page: Page,
  accept: (page: Page) => Promise<boolean>
): Promise<string | null> {
  for (const slug of (await productSlugs(page)).slice(0, 10)) {
    await goto(page, `/products/${slug}`);
    if (await accept(page)) return slug;
  }
  return null;
}

export const canAdd = (page: Page) => page.getByTestId('pdp-add-to-cart').isEnabled();

export async function addAnyProductToCart(page: Page): Promise<string> {
  const slug = await findProduct(page, canAdd);
  if (!slug)
    throw new Error('No product on the first shop page can be added; publish one with stock.');
  await page.getByTestId('pdp-add-to-cart').click();
  await expect(page.getByTestId('mini-cart')).toBeVisible();
  return slug;
}
