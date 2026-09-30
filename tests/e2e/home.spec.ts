import { test, expect } from '@playwright/test';
import { FIXTURES, escapeRegExp, goto } from './support/storefront';

test.describe('Home', () => {
  test('renders the manifest hero, its sections, the header and the footer', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('home-hero').locator('h1')).toHaveText(FIXTURES.heroTitle);
    await expect(page.getByTestId('home-section')).toHaveCount(FIXTURES.sectionCount);
    await expect(page.getByTestId('site-logo')).toBeVisible();
    await expect(page.getByTestId('header-nav-shop')).toBeVisible();
    await expect(page.getByTestId('header-nav-about')).toHaveText(FIXTURES.aboutLabel.en);
    await expect(page.getByTestId('site-footer').locator('a')).not.toHaveCount(0);
  });

  test('the hero button leads into the shop', async ({ page }) => {
    await goto(page, '/');
    await page.getByTestId('home-hero').getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(FIXTURES.heroLink)));
    await expect(page.getByTestId('product-grid')).toBeVisible();
  });
});
