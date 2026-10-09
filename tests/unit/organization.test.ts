import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_ORGANIZATION,
  clearOrganizationCache,
  dropOrganizationCache,
  loadOrganizationSettings,
  pickLocale,
  toOrganizationSettings,
} from '../../app/utils/organization';

const commerceOn = [
  { feature: 'CMS', enabled: true },
  { feature: 'ECOMMERCE', enabled: true },
];

describe('toOrganizationSettings', () => {
  it('reads currency, commerce and both locales', () => {
    const settings = toOrganizationSettings(
      { id: 'org-uuid', name: 'Shop', commerce: { currency: 'EUR' }, features: commerceOn },
      { availableLocales: ['en-US', 'is-IS'], defaultLocale: 'en-US' }
    );
    expect(settings).toEqual({
      id: 'org-uuid',
      name: 'Shop',
      b2b: false,
      currency: 'EUR',
      commerce: true,
      locales: ['en-US', 'is-IS'],
      defaultLocale: 'en-US',
    });
  });

  it('turns commerce off when the organization has no ECOMMERCE feature', () => {
    expect(
      toOrganizationSettings({ features: [{ feature: 'CMS', enabled: true }] }, null).commerce
    ).toBe(false);
    expect(
      toOrganizationSettings({ features: [{ feature: 'ECOMMERCE', enabled: false }] }, null)
        .commerce
    ).toBe(false);
  });

  it('turns business sales on with an enabled B2B feature only', () => {
    expect(
      toOrganizationSettings({ features: [...commerceOn, { feature: 'B2B', enabled: true }] }, null)
        .b2b
    ).toBe(true);
    expect(
      toOrganizationSettings({ features: [{ feature: 'B2B', enabled: false }] }, null).b2b
    ).toBe(false);
    expect(toOrganizationSettings(null, null).b2b).toBe(false);
    expect(toOrganizationSettings(null, null).id).toBe('');
  });

  it('keeps a single-locale organization to that locale', () => {
    const settings = toOrganizationSettings(
      { features: commerceOn },
      { availableLocales: ['is-IS'], defaultLocale: 'is-IS' }
    );
    expect(settings.locales).toEqual(['is-IS']);
    expect(settings.defaultLocale).toBe('is-IS');
    expect(pickLocale('en-US', settings)).toBe('is-IS');
  });

  it('falls back to en-US when none of the organization locales ship with the starter', () => {
    const settings = toOrganizationSettings(
      { features: commerceOn },
      { availableLocales: ['de-DE'], defaultLocale: 'de-DE' }
    );
    expect(settings.locales).toEqual(['en-US']);
    expect(settings.defaultLocale).toBe('en-US');
  });

  it('has no currency when the organization has no commerce settings', () => {
    expect(toOrganizationSettings({ features: commerceOn }, null).currency).toBeNull();
  });
});

describe('pickLocale', () => {
  it('keeps a current locale the organization offers', () => {
    expect(pickLocale('is-IS', FALLBACK_ORGANIZATION)).toBe('is-IS');
  });
});

describe('loadOrganizationSettings', () => {
  beforeEach(() => clearOrganizationCache());

  it('reads the organization once and caches it', async () => {
    const getOrganization = vi.fn(async () => ({
      name: 'Shop',
      commerce: { currency: 'USD' },
      features: commerceOn,
    }));
    const request = vi.fn(async ({ path }: { path: string }) => {
      if (path.endsWith('/i18n')) return { availableLocales: ['en-US'], defaultLocale: 'en-US' };
      throw new Error(`unexpected request path: ${path}`);
    });
    const eldra = { request, features: { getOrganization } } as never;
    const first = await loadOrganizationSettings(eldra, 'my-shop');
    const second = await loadOrganizationSettings(eldra, 'my-shop');
    expect(first).toBe(second);
    expect(first.currency).toBe('USD');
    expect(getOrganization).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ path: '/organization/v1/my-shop/i18n' });
  });

  it('reads the organization again after five minutes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const getOrganization = vi.fn(async () => ({ name: 'Shop', features: commerceOn }));
    const request = vi.fn(async () => ({ availableLocales: ['en-US'], defaultLocale: 'en-US' }));
    const eldra = { request, features: { getOrganization } } as never;
    await loadOrganizationSettings(eldra, 'my-shop');
    now.mockReturnValue(1_000_000 + 299_999);
    await loadOrganizationSettings(eldra, 'my-shop');
    expect(getOrganization).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 300_000);
    await loadOrganizationSettings(eldra, 'my-shop');
    expect(getOrganization).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('falls back and retries later when the organization cannot be read', async () => {
    const getOrganization = vi.fn(async () => {
      throw new Error('offline');
    });
    const request = vi.fn(async () => {
      throw new Error('offline');
    });
    const eldra = { request, features: { getOrganization } } as never;
    expect(await loadOrganizationSettings(eldra, 'my-shop')).toEqual(FALLBACK_ORGANIZATION);
    await loadOrganizationSettings(eldra, 'my-shop');
    expect(getOrganization.mock.calls.length).toBeGreaterThan(1);
  });

  const b2bOn = [...commerceOn, { feature: 'B2B', enabled: true }];

  it('keeps serving the last good settings when a later read fails', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let offline = false;
    const getOrganization = vi.fn(async () => {
      if (offline) throw new Error('offline');
      return { name: 'Shop', features: b2bOn };
    });
    const request = vi.fn(async () => ({ availableLocales: ['en-US'], defaultLocale: 'en-US' }));
    const eldra = { request, features: { getOrganization } } as never;
    expect((await loadOrganizationSettings(eldra, 'my-shop')).b2b).toBe(true);
    offline = true;
    now.mockReturnValue(1_000_000 + 300_000);
    expect((await loadOrganizationSettings(eldra, 'my-shop')).b2b).toBe(true);
    now.mockRestore();
  });

  it('reads again at once after dropOrganizationCache', async () => {
    const getOrganization = vi.fn(async () => ({ name: 'Shop', features: commerceOn }));
    const request = vi.fn(async () => ({ availableLocales: ['en-US'], defaultLocale: 'en-US' }));
    const eldra = { request, features: { getOrganization } } as never;
    await loadOrganizationSettings(eldra, 'my-shop');
    dropOrganizationCache('my-shop');
    await loadOrganizationSettings(eldra, 'my-shop');
    expect(getOrganization).toHaveBeenCalledTimes(2);
  });
});
