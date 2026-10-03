import { describe, expect, it } from 'vitest';
import { formatPrice, saleCompareAt } from '../../app/utils/price';

// Intl separates number and symbol with a no-break space; compare with plain spaces.
const plain = (value: string) => value.replace(/\s/g, ' ');

describe('formatPrice', () => {
  it('formats ISK the Icelandic way when the locale is is-IS', () => {
    expect(plain(formatPrice(12900, 'ISK', 'is-IS'))).toBe('12.900 kr.');
  });

  it('formats an organization currency that is not ISK', () => {
    expect(formatPrice(12.5, 'EUR', 'en-US')).toBe('€12.50');
    expect(formatPrice(1999.99, 'USD', 'en-US')).toBe('$1,999.99');
    // This Node's ICU renders is-IS EUR with the currency code, not the symbol.
    expect(plain(formatPrice(12.5, 'EUR', 'is-IS'))).toBe('12,50 EUR');
  });

  it('uses the locale it is given, not the process default', () => {
    expect(formatPrice(1000, 'EUR', 'en-US')).not.toBe(plain(formatPrice(1000, 'EUR', 'is-IS')));
  });

  it('formats a plain number when the organization has no currency', () => {
    expect(formatPrice(1234.5, null, 'en-US')).toBe('1,234.5');
  });

  it('shows an unusable currency code instead of throwing', () => {
    expect(formatPrice(10, 'NOPE', 'en-US')).toBe('10 NOPE');
  });
});

describe('saleCompareAt', () => {
  it('is a sale only when compare-at is strictly above the price', () => {
    expect(saleCompareAt(100, 120)).toBe(120);
    expect(saleCompareAt(100, 100)).toBeNull();
    expect(saleCompareAt(100, null)).toBeNull();
  });
});
