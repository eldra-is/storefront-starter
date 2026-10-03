import { describe, expect, it, vi } from 'vitest';
import { checkAvailability } from '../../app/utils/availability';

describe('checkAvailability', () => {
  it('makes no request and returns no badges without a default location', async () => {
    const availability = vi.fn();
    const result = await checkAvailability({ availability } as never, '', ['v1', 'v2']);
    expect(result.size).toBe(0);
    expect(availability).not.toHaveBeenCalled();
  });

  it('asks about every variant at the configured location', async () => {
    const availability = vi.fn(async () => ({
      items: [
        {
          variantId: 'v1',
          locationId: 'loc',
          available: false,
          availableQuantity: 0,
          allowBackorder: false,
        },
      ],
    }));
    const result = await checkAvailability({ availability } as never, 'loc', ['v1']);
    expect(availability).toHaveBeenCalledWith([{ variantId: 'v1', locationId: 'loc' }]);
    expect(result.get('v1')).toEqual({ available: false, availableQuantity: 0 });
  });
});
