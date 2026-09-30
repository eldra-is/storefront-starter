/** Stock per variant at NUXT_PUBLIC_DEFAULT_LOCATION_ID; empty when it is unset. */
export function useAvailability() {
  const eldra = useEldraClient();
  const locationId = String(useRuntimeConfig().public.defaultLocationId ?? '');
  return {
    check: (variantIds: string[]) => checkAvailability(eldra.inventory, locationId, variantIds),
  };
}
