import { test, expect } from '@playwright/test';
import { goto, priceDigits, productSlugs } from './support/storefront';

test.describe('Shop', () => {
  test('lists the catalog with a price on every card', async ({ page }) => {
    await goto(page, '/shop');
    const cards = page.locator('[data-testid^="product-card-"]');
    await expect(cards.first()).toBeVisible();
    for (const price of await cards.getByTestId('product-card-price').allInnerTexts()) {
      expect(priceDigits(price)).toBeGreaterThan(0);
    }
  });

  test('every was-price is above its price', async ({ page }) => {
    await goto(page, '/shop');
    const onSale = page
      .locator('[data-testid^="product-card-"]')
      .filter({ has: page.locator('.price-was') });
    const count = await onSale.count();
    test.skip(count === 0, 'No product on the first shop page is on sale.');
    for (const card of await onSale.all()) {
      const now = priceDigits(await card.getByTestId('product-card-price').innerText());
      const was = priceDigits(await card.locator('.price-was').innerText());
      expect(was).toBeGreaterThan(now);
    }
  });

  test('category chips filter the grid and sync to the URL', async ({ page }) => {
    await goto(page, '/shop');
    const chip = page
      .locator('[data-testid^="category-"]:not([data-testid="category-all"])')
      .first();
    test.skip((await chip.count()) === 0, 'The organization has no categories.');
    const slug = ((await chip.getAttribute('data-testid')) ?? '').replace('category-', '');
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`category=${slug}`));
    await expect(page.getByTestId(`category-${slug}`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid^="category-"][aria-current="page"]')).toHaveCount(1);
    await page.getByTestId('category-all').click();
    await expect(page).not.toHaveURL(/category=/);
    await expect(page.getByTestId('category-all')).toHaveAttribute('aria-current', 'page');
  });

  test('the mobile navigation expands live catalog categories', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goto(page, '/shop');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.getByTestId('header-catalog-menu')).toBeHidden();
    await page.getByRole('button', { name: 'Shop: Menu' }).click();
    await expect(page.getByTestId('header-catalog-menu')).toBeVisible();
    await expect(page.getByTestId('header-category-all')).toBeVisible();
  });

  test('a card opens its product page', async ({ page }) => {
    const [slug] = await productSlugs(page);
    await page.getByTestId(`product-card-${slug}`).click();
    await expect(page).toHaveURL(new RegExp(`/products/${slug}`));
    await expect(page.getByTestId('pdp-title')).not.toBeEmpty();
  });
});
