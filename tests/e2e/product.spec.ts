import { test, expect } from '@playwright/test';
import { canAdd, findProduct, goto, productSlugs } from './support/storefront';

test.describe('Product page', () => {
  test('shows a title and a price', async ({ page }) => {
    const [slug] = await productSlugs(page);
    await goto(page, `/products/${slug}`);
    await expect(page.getByTestId('pdp-title')).not.toBeEmpty();
    await expect(page.getByTestId('pdp-price')).not.toBeEmpty();
  });

  test('choosing an option value selects it and keeps a price', async ({ page }) => {
    const slug = await findProduct(
      page,
      async (p) => (await p.getByRole('radiogroup').count()) > 0
    );
    test.skip(!slug, 'No product with options on the first shop page.');
    const value = page.getByRole('radiogroup').first().getByRole('radio').last();
    await value.click();
    await expect(value).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('pdp-price')).not.toBeEmpty();
  });

  test('without a default location there are no stock badges and adding stays possible', async ({
    page,
  }) => {
    test.skip(
      Boolean(process.env.NUXT_PUBLIC_DEFAULT_LOCATION_ID),
      'A default location is configured.'
    );
    const slug = await findProduct(page, canAdd);
    expect(slug, 'at least one product can be added to the cart').not.toBeNull();
    await expect(page.getByTestId('pdp-sold-out')).toHaveCount(0);
    await expect(page.getByTestId('pdp-low-stock')).toHaveCount(0);
    await expect(page.getByTestId('pdp-add-to-cart')).toBeEnabled();
  });

  test('an unknown product is a 404', async ({ page }) => {
    const response = await page.goto('/products/does-not-exist');
    expect(response?.status()).toBe(404);
  });
});
