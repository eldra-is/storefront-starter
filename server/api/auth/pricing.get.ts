import type { CustomerPricingState } from '~~/shared/utils/customer-prices';

/**
 * Whether this browser has a business session and which company it buys for; read on the server
 * when a page renders (plugins/customer-pricing.ts). Signed out, or business login off: all false.
 */
export default defineEventHandler((event): Promise<CustomerPricingState> => {
  authResponseHeaders(event);
  return readPricingState(event);
});
