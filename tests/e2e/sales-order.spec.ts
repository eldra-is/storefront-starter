import { test, expect, type Page } from '@playwright/test';
import { addAnyProductToCart, goto } from './support/storefront';

/**
 * Order on account (B2B phase 5) against a real gateway. Needs what account.spec.ts needs (an
 * organization with B2B, the storefront client configured, E2E_SHOP_USER and E2E_SHOP_PASSWORD for
 * a business customer with exactly one company, or one already chosen), and E2E_SALES_ORDERS=1 once
 * that organization can take sales orders (contract 2.18.0). It places a real order on account:
 * run it against a test organization only.
 */
const user = process.env.E2E_SHOP_USER ?? '';
const password = process.env.E2E_SHOP_PASSWORD ?? '';
const enabled = Boolean(user && password && process.env.E2E_SALES_ORDERS === '1');

async function signIn(page: Page) {
  await goto(page, '/account');
  await page.getByTestId('account-sign-in').click();
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('[type="submit"]').first().click();
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
}

test.describe('Order on account', () => {
  test.skip(
    !enabled,
    'Set E2E_SHOP_USER, E2E_SHOP_PASSWORD and E2E_SALES_ORDERS=1 to place an order on account.'
  );

  test('cart → order on account → confirmation → history → order again', async ({ page }) => {
    await signIn(page);
    await addAnyProductToCart(page);
    await goto(page, '/cart');
    await page.getByTestId('cart-order-on-account').click();

    await expect(page.getByTestId('sales-order-preview')).toBeVisible();
    await expect(page.getByTestId('sales-order-total')).not.toBeEmpty();
    const po = `E2E-${Date.now()}`.slice(0, 40);
    await page.getByTestId('sales-order-po').fill(po);
    await page.getByTestId('sales-order-note').fill('Placed by the starter e2e test.');
    await page.getByTestId('sales-order-place').click();

    const confirmation = page.getByTestId('sales-order-confirmation');
    await expect(confirmation).toBeVisible();
    // The cart became the order: the basket starts afresh.
    await expect(page.getByTestId('header-cart-count')).toHaveCount(0);

    await goto(page, '/account/orders');
    const row = page.locator('[data-testid^="sales-order-row-"]').first();
    await expect(row).toBeVisible();
    await row.getByTestId('sales-order-link').click();
    await expect(page.getByTestId('sales-order-lines')).toBeVisible();

    await page.getByTestId('sales-order-again').click();
    await page.waitForURL((url) => url.pathname === '/cart');
    await expect(page.locator('[data-testid^="cart-line-"]').first()).toBeVisible();
  });

  test('the routes refuse another site, and a signed-out browser', async ({ page }) => {
    const crossSite = await page.request.post('/api/sales-orders', {
      headers: {
        Origin: 'https://evil.example.com',
        'Sec-Fetch-Site': 'cross-site',
        'Idempotency-Key': 'e2e-cross-site',
      },
      data: { cartId: '7a1d6c0e-3f7b-4c55-9b5e-0d6f3c1c9a10' },
    });
    expect(crossSite.status()).toBe(403);
    expect(crossSite.headers()['cache-control']).toBe('private, no-store');

    const signedOut = await page.request.get('/api/sales-orders');
    expect(signedOut.status()).toBe(401);
    expect(signedOut.headers()['cache-control']).toBe('private, no-store');
  });
});
