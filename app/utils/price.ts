/**
 * Every price on the site goes through here. The locale is always passed in, never read from the
 * runtime, so the server and the browser format the same number the same way. The currency comes
 * from the cart or the organization, never from code.
 */
export function formatPrice(
  amount: number,
  currency: string | null | undefined,
  locale: string
): string {
  const value = Number.isFinite(amount) ? amount : 0;
  if (!currency) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    // Not an ISO 4217 code: show the number and the code rather than nothing.
    return `${new Intl.NumberFormat(locale).format(value)} ${currency}`;
  }
}

/** Only strictly above the price is a sale; anything else is data mid-edit. */
export function saleCompareAt(price: number, compareAtPrice?: number | null): number | null {
  return typeof compareAtPrice === 'number' && compareAtPrice > price ? compareAtPrice : null;
}
