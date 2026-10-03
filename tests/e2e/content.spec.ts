import { test, expect } from '@playwright/test';
import { FIXTURES, goto } from './support/storefront';

test.describe('Content pages and language', () => {
  test('a block page renders its title, rich text and button', async ({ page }) => {
    await goto(page, `/pages/${FIXTURES.aboutPage}`);
    await expect(page.locator('h1')).toHaveText(FIXTURES.aboutTitle);
    await expect(page.getByTestId('block-text').locator('p').first()).not.toBeEmpty();
    await expect(page.getByTestId('block-button')).toHaveAttribute('href', '/shop');
  });

  test('a page renders a heading block', async ({ page }) => {
    await goto(page, `/pages/${FIXTURES.shippingPage}`);
    await expect(page.getByTestId('block-heading')).not.toBeEmpty();
  });

  test('an unknown page slug is a 404, not a 500', async ({ page }) => {
    const response = await page.goto('/pages/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
  });

  test('switching language changes navigation and the document language', async ({ page }) => {
    await goto(page, '/');
    await Promise.all([page.waitForEvent('load'), page.getByTestId('locale-switch').click()]);
    await expect(page.locator('html')).toHaveAttribute('lang', 'is');
    await expect(page.getByTestId('header-nav-about')).toHaveText(FIXTURES.aboutLabel.is);

    await Promise.all([page.waitForEvent('load'), page.getByTestId('locale-switch').click()]);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('header-nav-about')).toHaveText(FIXTURES.aboutLabel.en);
  });
});
