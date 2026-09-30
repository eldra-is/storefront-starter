import { test, expect } from '@playwright/test';
import {
  CHECKOUT_ORIGIN,
  FIXTURES,
  addAnyProductToCart,
  escapeRegExp,
  goto,
  priceDigits,
  reload,
} from './support/storefront';

test.describe('Cart', () => {
  test('adding opens the mini cart and updates the header count', async ({ page }) => {
    await addAnyProductToCart(page);
    await expect(page.getByTestId('mini-cart-item')).toHaveCount(1);
    await expect(page.getByTestId('header-cart-count')).toHaveText('1');
    await page.getByTestId('mini-cart-close').click();
    await expect(page.getByTestId('mini-cart')).toBeHidden();
    await expect(page.getByTestId('header-cart-count')).toHaveText('1');
  });

  test('quantity, removal and persistence across a reload', async ({ page }) => {
    await addAnyProductToCart(page);
    await goto(page, '/cart');
    const line = page.locator('[data-testid^="cart-line-"]').first();
    await expect(line.getByTestId('cart-line-title')).not.toBeEmpty();
    const unit = priceDigits(await page.getByTestId('cart-subtotal').innerText());
    await line.locator('[data-testid^="cart-inc-"]').click();
    await expect(line.locator('[data-testid^="cart-qty-"]')).toHaveText('2');
    await expect
      .poll(async () => priceDigits(await page.getByTestId('cart-subtotal').innerText()))
      .toBe(unit * 2);

    await reload(page);
    await expect(page.getByTestId('header-cart-count')).toHaveText('2');
    await page.locator('[data-testid^="cart-remove-"]').first().click();
    await expect(page.getByTestId('cart-empty')).toBeVisible();
  });

  test('a discount code reprices the cart and can be removed', async ({ page }) => {
    test.skip(!FIXTURES.discountCode, 'Set E2E_DISCOUNT_CODE to a live discount code.');
    await addAnyProductToCart(page);
    await goto(page, '/cart');
    const before = priceDigits(await page.getByTestId('cart-total').innerText());
    await page.getByTestId('cart-discount-input').fill(FIXTURES.discountCode.toLowerCase());
    await page.getByTestId('cart-discount-apply').click();
    await expect(page.getByTestId('cart-discount-applied')).toHaveText(FIXTURES.discountCode);
    expect(priceDigits(await page.getByTestId('cart-total').innerText())).toBeLessThan(before);
    await page.getByTestId('cart-discount-remove').click();
    await expect(page.getByTestId('cart-discount-input')).toBeVisible();
    await expect
      .poll(async () => priceDigits(await page.getByTestId('cart-total').innerText()))
      .toBe(before);
  });

  test('a code the shop does not honour is refused, not silently accepted', async ({ page }) => {
    await addAnyProductToCart(page);
    await goto(page, '/cart');
    await page.getByTestId('cart-discount-input').fill('NOPE-NOT-A-CODE');
    await page.getByTestId('cart-discount-apply').click();
    await expect(page.getByTestId('cart-discount-error')).toBeVisible();
    await expect(page.getByTestId('cart-discount-applied')).toHaveCount(0);
  });

  test('hands off to the hosted checkout with organization, cart and locale', async ({ page }) => {
    await addAnyProductToCart(page);
    await goto(page, '/cart');
    const href = await page.getByTestId('cart-checkout').getAttribute('href');
    expect(href).toMatch(
      new RegExp(`^${escapeRegExp(CHECKOUT_ORIGIN)}/checkout/[^/]+/[0-9a-f-]{36}\\?lang=en-US$`)
    );
  });

  test('an unknown recovery link says it has expired', async ({ page }) => {
    await goto(page, '/cart?recovery=not-a-real-token');
    await expect(page.getByTestId('cart-recovery-notice')).toHaveText('This link has expired.');
    await expect(page).not.toHaveURL(/recovery=/);
  });

  test('an empty cart shows the empty state and no checkout', async ({ page }) => {
    await goto(page, '/cart');
    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await expect(page.getByTestId('cart-checkout')).toHaveCount(0);
  });
});
