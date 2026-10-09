import { sessionCookieName } from '~~/shared/utils/auth';
import {
  SIGNED_IN_PAGE_CACHE_CONTROL,
  SIGNED_OUT_PRICING,
  type CustomerPricingState,
} from '~~/shared/utils/customer-prices';

/**
 * On the server, before any page data loads: is this a signed-in business customer, and for which
 * company? A page rendered for someone with a session cookie carries their prices in its HTML and
 * payload, so it is sent `private, no-store`; a guest's page is unchanged.
 */
export default defineNuxtPlugin({
  name: 'eldra-customer-pricing',
  dependsOn: ['eldra-organization'],
  async setup() {
    if (!import.meta.server || !useBusinessLogin().value) return;
    if (!useCookie(sessionCookieName(import.meta.dev)).value) return;
    useResponseHeader('Cache-Control').value = SIGNED_IN_PAGE_CACHE_CONTROL;
    const pricing = useCustomerPricing();
    try {
      pricing.value = await useRequestFetch()<CustomerPricingState>('/api/auth/pricing');
    } catch {
      pricing.value = { ...SIGNED_OUT_PRICING };
    }
  },
});
