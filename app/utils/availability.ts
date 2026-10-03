import type { EldraInventoryClient } from '@eldrajs/sdk';

export interface AvailabilityResult {
  available: boolean;
  availableQuantity: number;
}

/** Stock per variant at one location. No location configured: no request and no badges. */
export async function checkAvailability(
  inventory: Pick<EldraInventoryClient, 'availability'>,
  locationId: string,
  variantIds: string[]
): Promise<Map<string, AvailabilityResult>> {
  const map = new Map<string, AvailabilityResult>();
  if (!locationId || variantIds.length === 0) return map;
  const res = await inventory.availability(
    variantIds.map((variantId) => ({ variantId, locationId }))
  );
  for (const item of res?.items ?? []) {
    map.set(item.variantId, {
      available: item.available,
      availableQuantity: item.availableQuantity,
    });
  }
  return map;
}
