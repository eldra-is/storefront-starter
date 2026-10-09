import { test, expect } from '@playwright/test';
import { goto } from './support/storefront';

/**
 * Business login against a real shop realm. Needs an organization with the B2B feature, the
 * storefront client configured (NUXT_SHOP_CLIENT_SECRET and an issuer) and a business customer's
 * login with at least one company: E2E_SHOP_USER and E2E_SHOP_PASSWORD. Skipped otherwise.
 */
const user = process.env.E2E_SHOP_USER ?? '';
const password = process.env.E2E_SHOP_PASSWORD ?? '';

test.describe('Business account', () => {
  test.skip(!user || !password, 'Set E2E_SHOP_USER and E2E_SHOP_PASSWORD to run business login.');

  test('signs in through the shop realm, lists the companies and signs out', async ({ page }) => {
    await goto(page, '/');
    await page.getByTestId('header-account').click();
    await expect(page.getByTestId('account-signed-out')).toBeVisible();

    await page.getByTestId('account-sign-in').click();
    await page.locator('input[name="username"]').fill(user);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('[type="submit"]').first().click();

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId('account-signed-in')).toBeVisible();
    await expect(page.getByTestId('account-email')).toHaveText(new RegExp(user, 'i'));
    await expect(page.getByTestId('account-companies').locator('li')).not.toHaveCount(0);

    // The session cookie is opaque and httpOnly: no token reaches the browser.
    const cookie = (await page.context().cookies()).find((c) => c.name === 'eldra_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await page.getByTestId('account-sign-out').click();
    await page.waitForURL((url) => url.pathname === '/');
    await goto(page, '/account');
    await expect(page.getByTestId('account-signed-out')).toBeVisible();
  });

  test('starts sign-in at the shop realm without a referrer, even for a foreign return path', async ({
    page,
  }) => {
    const response = await page.request.get('/auth/login?returnTo=//evil.example.com', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(response.headers().location).toContain('/protocol/openid-connect/auth');
  });
});
